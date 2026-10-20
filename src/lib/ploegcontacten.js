/**
 * Ploegverantwoordelijken en coaches (V34).
 *
 * Twee lijsten met mensen die geen YOAssist-gebruiker zijn: ze loggen niet in
 * en hebben geen rol. Ze krijgen enkel bericht als er voor de wedstrijd van
 * hun ploeg te weinig scheidsrechters zijn — woensdagavond, en opnieuw
 * donderdagavond als het dan nog niet gelukt is.
 *
 * Beheer gaat met een sjabloon dat al ingevuld is met alle gevolgde ploegen
 * en wie er al op staat. Inlezen vervangt per ploeg die in het bestand staat;
 * ploegen die er niet in staan, blijven ongemoeid. Altijd eerst een droogloop.
 */
import { aantalNodig, vblOfficials } from './aanduiding.js';
import { komendWeekend } from './woensdag.js';
import { verwittigExtern } from './verwittigen.js';
import { templatePloegTekort } from './mailer.js';
import { log } from './logboek.js';

/** De twee lijsten. Een vaste lijst tabelnamen: de soort komt uit een request. */
export const SOORTEN = {
  pv: { tabel: 'ploeg_pv', label: 'ploegverantwoordelijken', bestand: 'yoassist-pv.csv' },
  coach: { tabel: 'ploeg_coaches', label: 'coaches', bestand: 'yoassist-coaches.csv' },
};

/** De kolommen zoals een beheerder ze in Excel ziet. */
export const KOLOMMEN = ['voornaam', 'naam', 'e-mail', 'team'];

const sleutel = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function geldigEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** De ploegen die beheerd worden: gevolgd, actief, bij een actieve club. */
export async function gevolgdeTeams(db) {
  const { results } = await db.prepare(
    `SELECT t.guid, t.naam
       FROM teams t JOIN clubs c ON c.guid = t.club_guid
      WHERE c.actief = 1 AND t.actief = 1 AND t.volgen = 1
      ORDER BY t.naam COLLATE NOCASE`,
  ).all();
  return results;
}

/** Iedereen uit één lijst, per ploeg. Alles in één keer: geen lijst sleutels als filter. */
export async function contactenPerTeam(db, soort) {
  const { results } = await db.prepare(
    `SELECT team_guid, voornaam, achternaam, email FROM ${SOORTEN[soort].tabel}
      ORDER BY voornaam COLLATE NOCASE, achternaam COLLATE NOCASE`,
  ).all();
  const per = new Map();
  for (const r of results) per.set(r.team_guid, [...(per.get(r.team_guid) ?? []), r]);
  return per;
}

/**
 * Het sjabloon: elke gevolgde ploeg, met wie er al op staat. Een ploeg zonder
 * iemand krijgt één regel met enkel de ploeg — zo zie je in één oogopslag
 * welke ploegen nog niemand hebben, en vul je die regel gewoon aan.
 */
export function sjabloonRijen(teams, perTeam) {
  return teams.flatMap((t) => {
    const personen = perTeam.get(t.guid) ?? [];
    if (personen.length === 0) return [{ voornaam: '', naam: '', 'e-mail': '', team: t.naam }];
    return personen.map((p) => ({ voornaam: p.voornaam, naam: p.achternaam ?? '', 'e-mail': p.email, team: t.naam }));
  });
}

/**
 * Wat een ingelezen bestand zou veranderen. Zuiver: geen databank.
 *
 * Per ploeg in het bestand is het bestand de nieuwe stand: wie er niet meer
 * in staat, gaat eruit. Heeft een ploeg ook maar één foute regel, dan blijft
 * die hele ploeg ongemoeid — anders zou een tikfout in een adres iemand
 * stilzwijgend van de lijst halen.
 *
 * @param {{guid: string, naam: string}[]} teams   de gevolgde ploegen
 * @param {Map<string, object[]>} perTeam          de huidige stand
 * @param {object[]} rijen                         uit leesCsv
 */
export function planImport(teams, perTeam, rijen) {
  // De ploeg herkennen op naam (zoals in het sjabloon) of op GUID.
  const opNaam = new Map();
  const dubbeleNamen = new Set();
  for (const t of teams) {
    const k = sleutel(t.naam);
    if (opNaam.has(k)) dubbeleNamen.add(k);
    opNaam.set(k, t);
  }
  const opGuid = new Map(teams.map((t) => [t.guid.toUpperCase(), t]));

  const inBestand = new Map();   // guid -> {team, personen, fout}
  const fouten = [];

  for (const rij of rijen) {
    const regel = rij._regel;
    const ruwTeam = String(rij.team ?? '').trim();
    const email = String(rij['e-mail'] ?? rij.email ?? '').trim().toLowerCase();
    const voornaam = String(rij.voornaam ?? '').trim();
    const achternaam = String(rij.naam ?? rij.achternaam ?? '').trim();

    if (!ruwTeam) {
      if (email || voornaam || achternaam) fouten.push({ regel, email, reden: 'geen ploeg ingevuld' });
      continue;
    }
    const k = sleutel(ruwTeam);
    const team = dubbeleNamen.has(k) ? null : (opNaam.get(k) ?? opGuid.get(ruwTeam.toUpperCase()));
    if (!team) {
      fouten.push({ regel, email, reden: dubbeleNamen.has(k)
        ? `ploeg '${ruwTeam}' bestaat twee keer: gebruik de GUID`
        : `ploeg '${ruwTeam}' niet gevonden bij de gevolgde ploegen` });
      continue;
    }

    const plek = inBestand.get(team.guid) ?? { team, personen: [], fout: false };
    inBestand.set(team.guid, plek);

    // Een regel met enkel de ploeg: die ploeg heeft (voortaan) niemand.
    if (!email && !voornaam && !achternaam) continue;

    const reden = !geldigEmail(email) ? 'ongeldig e-mailadres'
      : !voornaam ? 'voornaam ontbreekt'
        : plek.personen.some((p) => p.email === email) ? 'staat twee keer bij dezelfde ploeg'
          : null;
    if (reden) {
      fouten.push({ regel, email, reden, team: team.naam });
      plek.fout = true;
      continue;
    }
    plek.personen.push({ voornaam, achternaam, email });
  }

  const wijzigingen = [];
  const overgeslagen = [];
  let ongewijzigd = 0;

  for (const { team, personen, fout } of inBestand.values()) {
    if (fout) {
      overgeslagen.push({ team: team.naam, reden: 'een regel van deze ploeg bevat een fout' });
      continue;
    }
    const nu = perTeam.get(team.guid) ?? [];
    const nuOp = new Map(nu.map((p) => [p.email, p]));
    const nieuwOp = new Map(personen.map((p) => [p.email, p]));
    const nieuw = personen.filter((p) => !nuOp.has(p.email));
    const weg = nu.filter((p) => !nieuwOp.has(p.email));
    const hernoemd = personen.filter((p) => {
      const oud = nuOp.get(p.email);
      return oud && (oud.voornaam !== p.voornaam || (oud.achternaam ?? '') !== p.achternaam);
    });
    if (nieuw.length === 0 && weg.length === 0 && hernoemd.length === 0) {
      ongewijzigd++;
      continue;
    }
    wijzigingen.push({
      guid: team.guid,
      team: team.naam,
      personen,
      nieuw: nieuw.map(({ voornaam, achternaam, email }) => ({ voornaam, achternaam, email })),
      weg: weg.map(({ voornaam, achternaam, email }) => ({ voornaam, achternaam, email })),
      hernoemd: hernoemd.map(({ voornaam, achternaam, email }) => ({ voornaam, achternaam, email })),
    });
  }

  return { wijzigingen, overgeslagen, fouten, ongewijzigd };
}

/** De wijzigingen uit planImport wegschrijven: per ploeg alles eruit, en de nieuwe stand erin. */
export async function voerImportUit(db, soort, wijzigingen) {
  const tabel = SOORTEN[soort].tabel;
  const opdrachten = [];
  for (const w of wijzigingen) {
    opdrachten.push(db.prepare(`DELETE FROM ${tabel} WHERE team_guid = ?`).bind(w.guid));
    for (const p of w.personen) {
      opdrachten.push(db.prepare(
        `INSERT INTO ${tabel} (team_guid, voornaam, achternaam, email) VALUES (?, ?, ?, ?)`,
      ).bind(w.guid, p.voornaam, p.achternaam || null, p.email));
    }
  }
  if (opdrachten.length > 0) await db.batch(opdrachten);
}

/**
 * Eigen thuiswedstrijden van het komende weekend met te weinig scheidsrechters.
 *
 * 'Te weinig' = bond en club samen minder dan twee: precies wat 'nog nodig'
 * in het cluboverzicht toont. Niet enkel wat in de aanduidingslijst staat —
 * een wedstrijd die een beheerder eruit haalde maar waar niemand komt, is
 * voor de ploeg net zo goed een probleem. Wel overgeslagen: forfait, een
 * onbekende categorie (G08, ROL — daar komt nooit iemand), en wedstrijden
 * waarvan een beheerder bevestigde dat er twee scheidsrechters zijn.
 */
export async function tekortKomendWeekend(db, nu) {
  const [van, tot] = komendWeekend(nu);
  const { results } = await db.prepare(
    `SELECT m.guid, m.datum, m.uur, m.thuis_guid, m.thuis_naam, m.uit_naam, m.locatie,
            m.off_aantal, m.bond_officials,
            (SELECT COUNT(*) FROM assignments a
              WHERE a.match_guid = m.guid AND a.status = 'toegewezen') AS bezet
       FROM matches m
       JOIN categorieen cat ON cat.code = m.cat_code
      WHERE m.status = 'actief' AND m.forfait IS NULL AND m.refs_bevestigd = 0
        AND m.datum BETWEEN ? AND ?
      ORDER BY m.datum, m.uur`,
  ).bind(van, tot).all();

  return {
    van,
    tot,
    wedstrijden: results
      .map((m) => ({
        guid: m.guid, datum: m.datum, uur: m.uur, teamGuid: m.thuis_guid,
        thuis: m.thuis_naam, uit: m.uit_naam, locatie: m.locatie,
        nogNodig: aantalNodig(vblOfficials(m.off_aantal, m.bond_officials)) - m.bezet,
      }))
      .filter((w) => w.nogNodig > 0),
  };
}

/**
 * De PV's en coaches verwittigen van wedstrijden met te weinig scheidsrechters.
 *
 * Eén mail per persoon, ook als hij PV van de ene en coach van een andere
 * ploeg is: dan staan beide wedstrijden in dezelfde mail.
 *
 * @param {'woensdag'|'donderdag'} ronde
 */
export async function verwittigPloegen(env, nu, ronde) {
  const db = env.DB;
  const { van, tot, wedstrijden } = await tekortKomendWeekend(db, nu);
  const r = { ronde, van, tot, wedstrijden: wedstrijden.length, ontvangers: 0, mails: 0, zonderContact: [] };
  if (wedstrijden.length === 0) return r;

  const perOntvanger = new Map();
  const lijsten = await Promise.all(Object.keys(SOORTEN).map((s) => contactenPerTeam(db, s)));
  for (const w of wedstrijden) {
    const personen = lijsten.flatMap((l) => l.get(w.teamGuid) ?? []);
    if (personen.length === 0) r.zonderContact.push(w);
    for (const p of personen) {
      const plek = perOntvanger.get(p.email) ?? { voornaam: p.voornaam, wedstrijden: [] };
      if (!plek.wedstrijden.includes(w)) plek.wedstrijden.push(w);
      perOntvanger.set(p.email, plek);
    }
  }

  const { results: beheer } = await db.prepare(
    `SELECT voornaam || ' ' || achternaam AS naam, email FROM users
      WHERE is_admin = 1 AND actief = 1 ORDER BY voornaam COLLATE NOCASE`,
  ).all();

  for (const [email, { voornaam, wedstrijden: eigen }] of perOntvanger) {
    const res = await verwittigExtern(env, [email],
      templatePloegTekort({ voornaam, ronde, wedstrijden: eigen, contact: beheer }));
    r.mails += res.mails;
  }
  r.ontvangers = perOntvanger.size;

  await log(db, {
    categorie: 'beheer', soort: 'ploegbericht', wie: 'systeem',
    veld: `PV's en coaches, ${ronde}`,
    nieuw: `${van} tot ${tot}: ${wedstrijden.length} wedstrijd(en) met te weinig scheidsrechters, ` +
      `${r.mails} van ${r.ontvangers} mail(s) verstuurd` +
      (r.zonderContact.length ? `, ${r.zonderContact.length} ploeg(en) zonder PV of coach` : ''),
  });
  return r;
}
