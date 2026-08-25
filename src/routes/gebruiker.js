import { json, fout, leesJson, instelling } from '../lib/http.js';
import { seizoenLabel, seizoenscode, wedstrijdbladUrl } from '../lib/vbl.js';
import { aantalNodig, opkomstUur } from '../lib/aanduiding.js';
import { verstuur, templateProbleem } from '../lib/mailer.js';
import { VERSIE } from '../versie.js';

/**
 * Zorgt dat de gebruiker aan een club hangt.
 *
 * Is er precies één actieve club geconfigureerd, dan valt er niets te kiezen en
 * koppelen we stilzwijgend. Zijn er meerdere, dan moet de gebruiker zelf
 * kiezen — de app kan niet raden bij welke club iemand aan de tafel staat.
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
export async function matches({ env, user }) {
  const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));
  const { user: bijgewerkt, keuze } = await zorgVoorClub(env, user);

  if (keuze) return json({ seizoen, matches: [], clubKeuze: keuze });

  const { email, profiel, clubGuid } = bijgewerkt;
  const vandaag = new Date().toISOString().slice(0, 10);

  // Een YO ziet alleen U10/U12. Een YO+ ziet alles wat in de aanduidingslijst
  // staat: dus ook wat een beheerder of de woensdagregel erbij heeft gezet.
  const profielFilter = profiel === 'YO+' ? '' : "AND cat.groep = 'U10U12'";

  const { results } = await env.DB.prepare(
    `SELECT m.guid, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.locatie, m.poule_naam,
            m.cat_code, m.off_aantal, m.off_namen, m.off_gewist, m.scope_reden,
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
  // Een official wil weten met wie hij aan de tafel staat — ook als hij zelf
  // (nog) niet is aangeduid.
  const guids = results.map((r) => r.guid);
  const perWedstrijd = new Map();

  if (guids.length > 0) {
    const gaten = guids.map(() => '?').join(',');
    const { results: aanduidingen } = await env.DB.prepare(
      `SELECT a.match_guid, u.email, u.voornaam, u.achternaam
         FROM assignments a
         JOIN users u ON u.email = a.user_email
        WHERE a.match_guid IN (${gaten}) AND a.status = 'toegewezen'
        ORDER BY u.achternaam COLLATE NOCASE, u.voornaam COLLATE NOCASE`,
    )
      .bind(...guids)
      .all();

    for (const a of aanduidingen) {
      perWedstrijd.set(a.match_guid, [
        ...(perWedstrijd.get(a.match_guid) ?? []),
        { naam: `${a.voornaam} ${a.achternaam}`, ikZelf: a.email === email },
      ]);
    }
  }

  return json({
    seizoen,
    clubNaam: bijgewerkt.clubNaam,
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
        wedstrijdblad: wedstrijdbladUrl(r.guid),
        beschikbaarheid: r.beschikbaarheid ?? null,
        // Toegewezen aan mij: dan is de beschikbaarheid vergrendeld en kan er
        // alleen nog een probleem gemeld worden.
        toegewezen: r.aanduiding === 'toegewezen',
        nodig: aantalNodig(r.off_aantal),
        bezet: club.length,
        opkomst: opkomstUur(r.uur),
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

  const { email, profiel, clubGuid } = user;
  if (!clubGuid) return fout(403, 'Geen club', 'Je account is nog aan geen club gekoppeld.');

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
    await Promise.all(
      beheerders.results.map((b) =>
        verstuur(env, { naar: b.email, ...mail }).catch(() => ({ verstuurd: false })),
      ),
    );
  }

  return json({ ok: true, matchGuid: guid });
}
