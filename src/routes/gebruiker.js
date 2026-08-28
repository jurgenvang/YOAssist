import { json, fout, leesJson, instelling } from '../lib/http.js';
import { seizoenLabel, seizoenscode, wedstrijdbladUrl } from '../lib/vbl.js';
import { aantalNodig, opkomstUur } from '../lib/aanduiding.js';
import { templateProbleem } from '../lib/mailer.js';
import { verwittigAllen } from '../lib/verwittigen.js';
import { log } from '../lib/logboek.js';
import { whatsappLink, belLink, toonNummer } from '../lib/telefoon.js';
import { kinderenVan, bepaalPersoon } from '../lib/namens.js';
import { VERSIE } from '../versie.js';

/**
 * Zorgt dat de gebruiker aan een club hangt.
 *
 * Is er precies één actieve club geconfigureerd, dan valt er niets te kiezen en
 * koppelen we stilzwijgend. Zijn er meerdere, dan moet de gebruiker zelf
 * kiezen — de app kan niet raden voor welke club iemand fluit.
 *
 * Geeft de eventueel bijgewerkte gebruiker terug, plus de clubs waaruit gekozen
 * moet worden zolang er geen keuze is.
 */
export async function zorgVoorClub(env, user) {
  if (user.clubGuid) return { user, keuze: null };

  const { results: clubs } = await env.DB.prepare(
    'SELECT guid, naam FROM clubs WHERE actief = 1 ORDER BY naam COLLATE NOCASE, guid',
  ).all();

  if (clubs.length === 0) {
    return { user, keuze: { clubs: [], reden: 'geen-clubs' } };
  }

  if (clubs.length === 1) {
    const club = clubs[0];
    await env.DB.prepare('UPDATE users SET club_guid = ? WHERE email = ?')
      .bind(club.guid, user.email)
      .run();
    return {
      user: { ...user, clubGuid: club.guid, clubNaam: club.naam, clubAutomatisch: true },
      keuze: null,
    };
  }

  return {
    user,
    keuze: {
      reden: 'meerdere-clubs',
      clubs: clubs.map((c) => ({ guid: c.guid, naam: c.naam ?? c.guid })),
    },
  };
}

/** GET /api/me — wie ben ik, wat mag ik zien, en welke versie draait er. */
export async function me({ env, user }) {
  const startJaar = Number(await instelling(env.DB, 'seizoen_start_jaar', '2026'));
  const { user: bijgewerkt, keuze } = await zorgVoorClub(env, user);

  return json({
    ...bijgewerkt,
    versie: VERSIE,
    seizoen: seizoenLabel(startJaar),
    clubKeuze: keuze,
    // Voor wie namens zijn kinderen mag invullen. Leeg voor de meesten.
    kinderen: await kinderenVan(env.DB, bijgewerkt.email),
  });
}

/** GET /api/clubs — de clubs waaruit een gebruiker kan kiezen. */
export async function clubs({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT guid, naam FROM clubs WHERE actief = 1 ORDER BY naam COLLATE NOCASE, guid',
  ).all();

  return json({ clubs: results.map((c) => ({ guid: c.guid, naam: c.naam ?? c.guid })) });
}

/**
 * POST /api/club   { guid }
 *
 * De gebruiker koppelt zichzelf aan een club. Alleen aan clubs die de beheerder
 * heeft geconfigureerd en die actief zijn — anders zou iemand zich aan een
 * willekeurige GUID kunnen hangen en wedstrijden zien die hem niet aangaan.
 */
export async function kiesClub({ request, env, user }) {
  const body = await leesJson(request);
  const guid = typeof body.guid === 'string' ? body.guid.trim().toUpperCase() : '';

  if (!guid) return fout(400, 'Ongeldige aanvraag', 'guid ontbreekt.');

  const club = await env.DB.prepare('SELECT guid, naam FROM clubs WHERE guid = ? AND actief = 1')
    .bind(guid)
    .first();

  if (!club) {
    return fout(404, 'Onbekende club', 'Deze club is niet geconfigureerd of staat op inactief.');
  }

  await env.DB.prepare('UPDATE users SET club_guid = ? WHERE email = ?')
    .bind(club.guid, user.email)
    .run();

  return json({ clubGuid: club.guid, clubNaam: club.naam });
}

/**
 * GET /api/matches — thuiswedstrijden voor de aangemelde Youth Official.
 *
 * Filtering: actief seizoen, eigen club, teams die voor zijn profiel aangevinkt
 * staan (YO ziet teams.yo, YO+ ziet teams.yo_plus), niet verdwenen, en vanaf
 * vandaag. Sortering op datum, uur, ploeg; de frontend groepeert per maand.
 */
export async function matches({ url, env, user }) {
  // Een ouder kan de lijst van zijn kind opvragen. Zonder koppeling weigeren we
  // dat; stilzwijgend de eigen lijst tonen zou verwarrend zijn.
  const persoon = await bepaalPersoon(env.DB, user, url?.searchParams?.get('namens'));
  if (persoon.fout) return fout(403, 'Niet toegestaan', persoon.fout);
  const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));
  const { user: bijgewerkt, keuze } = await zorgVoorClub(env, user);

  if (keuze) return json({ seizoen, matches: [], clubKeuze: keuze });

  // De club en het profiel komen van de persoon om wie het gaat, niet van wie
  // er is aangemeld: een kind kan een ander profiel hebben dan zijn ouder.
  const kindRij = persoon.namensKind
    ? await env.DB.prepare('SELECT email, profiel, club_guid FROM users WHERE email = ?')
        .bind(persoon.email).first()
    : null;

  const email = kindRij?.email ?? bijgewerkt.email;
  const profiel = kindRij?.profiel ?? bijgewerkt.profiel;
  const clubGuid = kindRij?.club_guid ?? bijgewerkt.clubGuid;
  const vandaag = new Date().toISOString().slice(0, 10);

  // Een YO ziet alleen U10/U12. Een YO+ ziet alles wat in de aanduidingslijst
  // staat: dus ook wat een beheerder of de woensdagregel erbij heeft gezet.
  //
  // Een beheerder kan met ?alsProfiel=YO kijken zoals een gewone official.
  // Die parameter kan het resultaat alleen versmallen, nooit verbreden: wie
  // YO is, wordt er geen YO+ mee. Zo blijft de identiteit uit Access leidend
  // en is de schakelaar geen achterdeur.
  const gevraagd = url?.searchParams?.get('alsProfiel');
  const zichtbaarProfiel = gevraagd === 'YO' ? 'YO' : profiel;

  const profielFilter = zichtbaarProfiel === 'YO+' ? '' : "AND cat.groep = 'U10U12'";

  const { results } = await env.DB.prepare(
    `SELECT m.guid, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.locatie, m.poule_naam,
            m.cat_code, m.off_aantal, m.off_namen, m.off_gewist, m.scope_reden, m.uitslag,
            cat.label AS cat_label, cat.groep AS cat_groep,
            a.status AS beschikbaarheid,
            eigen.status AS aanduiding
       FROM matches m
       JOIN teams t ON t.guid = m.thuis_guid
       LEFT JOIN categorieen cat ON cat.code = m.cat_code
       LEFT JOIN availability a ON a.match_guid = m.guid AND a.user_email = ?
       LEFT JOIN assignments eigen ON eigen.match_guid = m.guid AND eigen.user_email = ?
      WHERE m.seizoen = ?
        AND m.status = 'actief'
        AND m.scope = 1
        AND m.club_guid = ?
        AND t.actief = 1
        AND m.datum >= ?
        ${profielFilter}
      ORDER BY m.datum, m.uur, m.thuis_naam COLLATE NOCASE`,
  )
    .bind(email, email, seizoen, clubGuid, vandaag)
    .all();

  // Wie er van de club is aangeduid, in één query in plaats van per wedstrijd.
  // Een official wil weten met wie hij samen fluit — ook als hij zelf
  // (nog) niet is aangeduid.
  // Niet met een IN-lijst van GUID's: D1 laat maximaal honderd gebonden
  // parameters per query toe, en een seizoen levert er meer op. Dezelfde
  // voorwaarden hergebruiken kost er drie.
  const perWedstrijd = new Map();

  if (results.length > 0) {
    const { results: aanduidingen } = await env.DB.prepare(
      `SELECT a.match_guid, u.email, u.voornaam, u.achternaam, u.gsm, u.gsm_delen
         FROM assignments a
         JOIN users u ON u.email = a.user_email
         JOIN matches m ON m.guid = a.match_guid
        WHERE a.status = 'toegewezen'
          AND m.seizoen = ? AND m.status = 'actief' AND m.club_guid = ? AND m.datum >= ?
        ORDER BY a.toegewezen_op, u.achternaam COLLATE NOCASE`,
    )
      .bind(seizoen, clubGuid, vandaag)
      .all();

    // Op welke wedstrijden sta ik zelf? Alleen daar mag ik het nummer van een
    // collega zien — niet bij elke wedstrijd van de club.
    const ikSta = new Set(
      aanduidingen.filter((a) => a.email === email).map((a) => a.match_guid),
    );

    for (const a of aanduidingen) {
      const ikZelf = a.email === email;
      // Nummer tonen als: ik sta zelf op die wedstrijd, hij deelt zijn nummer,
      // en hij is niet mezelf. Elkaar kunnen bereiken is het punt; de rest van
      // de club heeft dat nummer niet nodig.
      const magNummer = !ikZelf && ikSta.has(a.match_guid) && a.gsm_delen === 1 && a.gsm;

      perWedstrijd.set(a.match_guid, [
        ...(perWedstrijd.get(a.match_guid) ?? []),
        {
          naam: `${a.voornaam} ${a.achternaam}`,
          ikZelf,
          gsm: magNummer ? toonNummer(a.gsm) : null,
          whatsapp: magNummer ? whatsappLink(a.gsm) : null,
          bellen: magNummer ? belLink(a.gsm) : null,
        },
      ]);
    }
  }

  return json({
    seizoen,
    clubNaam: bijgewerkt.clubNaam,
    profiel: zichtbaarProfiel,
    // Voor wie de lijst is. De frontend toont dat in de balk zodat niemand per
    // ongeluk voor de verkeerde persoon antwoordt.
    namens: persoon.namensKind ? { email: persoon.email, naam: persoon.naam } : null,
    matches: results.map((r) => {
      let vblRefs = [];
      try {
        vblRefs = r.off_namen ? JSON.parse(r.off_namen) : [];
      } catch {
        vblRefs = [];
      }

      const club = perWedstrijd.get(r.guid) ?? [];

      return {
        guid: r.guid,
        datum: r.datum,
        uur: r.uur,
        thuis: r.thuis_naam,
        uit: r.uit_naam,
        locatie: r.locatie,
        poule: r.poule_naam,
        catCode: r.cat_code,
        catLabel: r.cat_label,
        catGroep: r.cat_groep,
        wedstrijdblad: wedstrijdbladUrl(r.guid),
        beschikbaarheid: r.beschikbaarheid ?? null,
        // Toegewezen aan mij: dan is de beschikbaarheid vergrendeld en kan er
        // alleen nog een probleem gemeld worden.
        toegewezen: r.aanduiding === 'toegewezen',
        nodig: aantalNodig(r.off_aantal),
        bezet: club.length,
        opkomst: opkomstUur(r.uur),
        // Puur ter info: enkel gevuld als de wedstrijd gespeeld is en
        // Basketbal Vlaanderen de uitslag doorgeeft.
        uitslag: r.uitslag ?? null,
        // Scheidsrechters van de bond. De namen worden een dag na de wedstrijd
        // gewist; het aantal blijft, vandaar beide velden.
        vblRefs,
        vblAantal: r.off_aantal,
        vblNamenGewist: r.off_gewist === 1,
        // Aangeduide officials van de eigen club, met de eigen naam gemarkeerd.
        clubRefs: club,
      };
    }),
  });
}

/**
 * POST /api/availability   { matchGuid, status: 'ja' | 'nee' | null }
 *
 * status null wist het antwoord, zodat een vergissing terug kan naar 'nog niet
 * geantwoord'. De gebruiker komt uit de geverifieerde identiteit, nooit uit de
 * body. En de wedstrijd moet er één zijn die deze gebruiker ook echt te zien
 * krijgt: anders zou iemand beschikbaarheden kunnen zetten voor ploegen buiten
 * zijn club of profiel.
 */
export async function zetBeschikbaarheid({ request, env, user }) {
  const body = await leesJson(request);
  const { matchGuid, status } = body;

  if (typeof matchGuid !== 'string' || !matchGuid.trim()) {
    return fout(400, 'Ongeldige aanvraag', 'matchGuid ontbreekt.');
  }
  if (status !== 'ja' && status !== 'nee' && status !== null) {
    return fout(400, 'Ongeldige aanvraag', "status moet 'ja', 'nee' of null zijn.");
  }

  const persoon = await bepaalPersoon(env.DB, user, body.namens);
  if (persoon.fout) return fout(403, 'Niet toegestaan', persoon.fout);

  const rij = persoon.namensKind
    ? await env.DB.prepare('SELECT email, profiel, club_guid FROM users WHERE email = ?')
        .bind(persoon.email).first()
    : null;

  const email = rij?.email ?? user.email;
  const profiel = rij?.profiel ?? user.profiel;
  const clubGuid = rij?.club_guid ?? user.clubGuid;

  if (!clubGuid) return fout(403, 'Geen club', 'Dit account is nog aan geen club gekoppeld.');

  const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));
  const profielFilter = profiel === 'YO+' ? '' : "AND cat.groep = 'U10U12'";

  const toegestaan = await env.DB.prepare(
    `SELECT m.guid
       FROM matches m
       JOIN teams t ON t.guid = m.thuis_guid
       LEFT JOIN categorieen cat ON cat.code = m.cat_code
      WHERE m.guid = ? AND m.seizoen = ? AND m.status = 'actief' AND m.scope = 1
        AND m.club_guid = ? AND t.actief = 1
        ${profielFilter}`,
  )
    .bind(matchGuid, seizoen, clubGuid)
    .first();

  if (!toegestaan) {
    return fout(404, 'Wedstrijd niet gevonden', 'Deze wedstrijd staat niet in jouw lijst.');
  }

  // Eens aangeduid kan een official zijn beschikbaarheid niet meer wijzigen.
  // Wie een probleem heeft, meldt dat; de beheerder beslist.
  const aanduiding = await env.DB.prepare(
    `SELECT status FROM assignments WHERE match_guid = ? AND user_email = ? AND status = 'toegewezen'`,
  )
    .bind(matchGuid, email)
    .first();

  if (aanduiding) {
    return fout(
      409,
      'Je bent aangeduid',
      'Voor deze wedstrijd ben je aangeduid. Meld een probleem als het niet lukt.',
    );
  }

  if (status === null) {
    await env.DB.prepare('DELETE FROM availability WHERE user_email = ? AND match_guid = ?')
      .bind(email, matchGuid)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO availability (user_email, match_guid, status, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (user_email, match_guid)
       DO UPDATE SET status = excluded.status, updated_at = datetime('now')`,
    )
      .bind(email, matchGuid, status)
      .run();
  }

  return json({ ok: true, matchGuid, status });
}

/**
 * POST /api/probleem   { matchGuid, bericht }
 *
 * De uitweg voor een official die is aangeduid maar niet kan. Hij kan de
 * aanduiding niet zelf ongedaan maken — dat zou de beheerder voor verrassingen
 * zetten — maar hij kan wel melden dat er iets is.
 */
export async function meldProbleem({ request, env, user }) {
  const body = await leesJson(request);
  const guid = typeof body.matchGuid === 'string' ? body.matchGuid.trim() : '';
  const bericht = String(body.bericht ?? '').trim();

  if (!guid) return fout(400, 'Ongeldige aanvraag', 'matchGuid ontbreekt.');
  if (bericht.length < 3) {
    return fout(400, 'Bericht te kort', 'Schrijf kort waarom het niet lukt.');
  }
  if (bericht.length > 1000) {
    return fout(400, 'Bericht te lang', 'Hou het bij duizend tekens.');
  }

  const aanduiding = await env.DB.prepare(
    `SELECT status FROM assignments WHERE match_guid = ? AND user_email = ?`,
  )
    .bind(guid, user.email)
    .first();

  if (!aanduiding) {
    return fout(404, 'Geen aanduiding', 'Je bent niet aangeduid voor deze wedstrijd.');
  }

  await env.DB.prepare(
    'INSERT INTO problemen (match_guid, user_email, bericht) VALUES (?, ?, ?)',
  )
    .bind(guid, user.email, bericht)
    .run();

  await log(env.DB, {
    categorie: 'aanduiding',
    soort: 'probleem',
    matchGuid: guid,
    wie: user.email,
    veld: 'gemeld',
    nieuw: bericht.slice(0, 200),
  });

  // Naar alle actieve beheerders, niet naar één vast adres: wie er dat
  // seizoen ook beheert, moet dit kunnen zien.
  const [wedstrijd, beheerders] = await Promise.all([
    env.DB.prepare('SELECT thuis_naam, uit_naam FROM matches WHERE guid = ?').bind(guid).first(),
    env.DB.prepare('SELECT email FROM users WHERE is_admin = 1 AND actief = 1').all(),
  ]);

  if (wedstrijd) {
    const mail = templateProbleem({
      wedstrijd: `${wedstrijd.thuis_naam} - ${wedstrijd.uit_naam}`,
      bericht,
      official: user.naam,
    });
    await verwittigAllen(env, beheerders.results.map((b) => b.email), mail);
  }

  return json({ ok: true, matchGuid: guid });
}
