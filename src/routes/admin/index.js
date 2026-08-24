import { json, fout, leesJson, instelling } from '../../lib/http.js';
import {
  clubDetail,
  normaliseerGuid,
  categorieUitTeamGuid,
  CLUB_GUID_PATROON,
  seizoenLabel,
  huidigSeizoenStartJaar,
  VblError,
} from '../../lib/vbl.js';
import { synchroniseer, zetInstelling } from '../../lib/sync.js';

/** GET /api/admin/config — alles wat het beheerscherm in één keer nodig heeft. */
export async function config({ env }) {
  const db = env.DB;
  const startJaar = Number(await instelling(db, 'seizoen_start_jaar', huidigSeizoenStartJaar()));

  const [clubs, teams, laatsteSync, open] = await Promise.all([
    db.prepare('SELECT guid, naam, actief FROM clubs ORDER BY naam, guid').all(),
    db
      .prepare(
        `SELECT t.guid, t.club_guid, t.naam, t.cat_code, t.yo, t.yo_plus, t.actief,
                c.label AS cat_label, c.groep AS cat_groep, c.tarief_cent
           FROM teams t
           LEFT JOIN categorieen c ON c.code = t.cat_code
          ORDER BY t.club_guid, t.naam COLLATE NOCASE`,
      )
      .all(),
    db
      .prepare(
        `SELECT gestart, geeindigd, bron, status, aantal_gevonden, aantal_nieuw,
                aantal_gewijzigd, aantal_verdwenen, boodschap
           FROM sync_runs ORDER BY id DESC LIMIT 1`,
      )
      .first(),
    db.prepare('SELECT COUNT(*) AS aantal FROM match_changes WHERE afgehandeld = 0').first(),
  ]);

  return json({
    seizoen: {
      startJaar,
      label: seizoenLabel(startJaar),
      voorstelUitDatum: huidigSeizoenStartJaar(),
    },
    clubs: clubs.results.map((c) => ({ guid: c.guid, naam: c.naam, actief: c.actief === 1 })),
    teams: teams.results.map((t) => ({
      guid: t.guid,
      clubGuid: t.club_guid,
      naam: t.naam,
      catCode: t.cat_code,
      catLabel: t.cat_label,
      catGroep: t.cat_groep,
      // Geen rij in categorieen betekent: geen tarief en geen automatische
      // scope. Dat moet zichtbaar zijn, niet stil.
      catBekend: t.cat_label !== null && t.cat_label !== undefined,
      tariefCent: t.tarief_cent ?? null,
      yo: t.yo === 1,
      yoPlus: t.yo_plus === 1,
      actief: t.actief === 1,
    })),
    laatsteSync,
    openWijzigingen: open?.aantal ?? 0,
  });
}

/**
 * POST /api/admin/season   { actie: 'omhoog' | 'omlaag' | 'volgDatum' }
 *                       of { startJaar: 2027 }
 * Een seizoen loopt van juli tot juni.
 */
export async function season({ request, env }) {
  const body = await leesJson(request);
  const huidig = Number(await instelling(env.DB, 'seizoen_start_jaar', huidigSeizoenStartJaar()));

  let nieuw;
  if (typeof body.startJaar === 'number') nieuw = Math.trunc(body.startJaar);
  else if (body.actie === 'omhoog') nieuw = huidig + 1;
  else if (body.actie === 'omlaag') nieuw = huidig - 1;
  else if (body.actie === 'volgDatum') nieuw = huidigSeizoenStartJaar();
  else return fout(400, 'Ongeldige aanvraag', "Geef 'actie' of 'startJaar' mee.");

  if (nieuw < 2000 || nieuw > 2100) {
    return fout(400, 'Ongeldig seizoen', 'Het startjaar ligt buiten een zinnig bereik.');
  }

  await zetInstelling(env.DB, 'seizoen_start_jaar', nieuw);
  return json({ startJaar: nieuw, label: seizoenLabel(nieuw) });
}

/**
 * GET /api/admin/resolve-club?guid=BVBL1053[&diagnose=1]
 *
 * Controleknop achter het GUID-veld: haalt naam en teamlijst op zonder iets te
 * bewaren. Met diagnose=1 komt er een fragment van de ruwe respons mee, voor
 * het geval de teamherkenning niets vindt.
 */
export async function resolveClub({ url, env }) {
  const guid = normaliseerGuid(url.searchParams.get('guid') ?? '').toUpperCase();
  const diagnose = url.searchParams.get('diagnose') === '1';

  if (!CLUB_GUID_PATROON.test(guid)) {
    return fout(400, 'Ongeldige GUID', 'Een club-GUID heeft de vorm BVBL gevolgd door vier cijfers.');
  }

  let detail;
  try {
    detail = await clubDetail(guid);
  } catch (err) {
    return fout(502, 'Basketbal Vlaanderen', err instanceof VblError ? err.message : String(err));
  }

  const bestaat = await env.DB.prepare('SELECT guid FROM clubs WHERE guid = ?').bind(guid).first();

  const antwoord = {
    guid,
    naam: detail.naam,
    aantalTeams: detail.teams.length,
    teams: detail.teams.slice(0, 100),
    reedsToegevoegd: Boolean(bestaat),
  };

  if (!detail.naam || detail.teams.length === 0) {
    antwoord.waarschuwing =
      'De naam of de teamlijst kon niet herkend worden. Vraag de diagnose op om te zien hoe de respons is opgebouwd.';
  }

  if (diagnose) {
    antwoord.diagnose = {
      sleutelsOpTopniveau: Array.isArray(detail.rauw)
        ? `array van ${detail.rauw.length}`
        : Object.keys(detail.rauw ?? {}),
      fragment: JSON.stringify(detail.rauw).slice(0, 4000),
    };
  }

  return json(antwoord);
}

/** POST /api/admin/clubs   { guid } */
export async function clubToevoegen({ request, env }) {
  const body = await leesJson(request);
  const guid = normaliseerGuid(body.guid ?? '').toUpperCase();

  if (!CLUB_GUID_PATROON.test(guid)) {
    return fout(400, 'Ongeldige GUID', 'Een club-GUID heeft de vorm BVBL gevolgd door vier cijfers.');
  }

  // Naam ophalen als controle. Lukt dat niet, dan voegen we de club toch toe:
  // een tijdelijke storing bij Wisseq mag geen blokkade zijn.
  let naam = null;
  let waarschuwing = null;
  try {
    naam = (await clubDetail(guid)).naam;
  } catch (err) {
    waarschuwing = `Club toegevoegd, maar de naam kon niet opgehaald worden${
      err instanceof VblError ? `: ${err.message}` : '.'
    }`;
  }

  await env.DB.prepare(
    `INSERT INTO clubs (guid, naam, actief) VALUES (?, ?, 1)
     ON CONFLICT (guid) DO UPDATE SET naam = COALESCE(excluded.naam, clubs.naam), actief = 1`,
  )
    .bind(guid, naam)
    .run();

  return json({ guid, naam, waarschuwing });
}

/** PATCH /api/admin/clubs   { guid, actief } */
export async function clubAanUit({ request, env }) {
  const body = await leesJson(request);
  const guid = normaliseerGuid(body.guid ?? '').toUpperCase();

  if (!CLUB_GUID_PATROON.test(guid)) return fout(400, 'Ongeldige GUID', 'Onbekende clubvorm.');
  if (typeof body.actief !== 'boolean') {
    return fout(400, 'Ongeldige aanvraag', 'actief moet true of false zijn.');
  }

  await env.DB.prepare('UPDATE clubs SET actief = ? WHERE guid = ?')
    .bind(body.actief ? 1 : 0, guid)
    .run();

  return json({ guid, actief: body.actief });
}

/** DELETE /api/admin/clubs?guid=... */
export async function clubVerwijderen({ url, env }) {
  const guid = normaliseerGuid(url.searchParams.get('guid') ?? '').toUpperCase();
  if (!CLUB_GUID_PATROON.test(guid)) return fout(400, 'Ongeldige GUID', 'Onbekende clubvorm.');

  const gekoppeld = await env.DB.prepare('SELECT COUNT(*) AS aantal FROM users WHERE club_guid = ?')
    .bind(guid)
    .first();

  if ((gekoppeld?.aantal ?? 0) > 0) {
    return fout(
      409,
      'Club nog in gebruik',
      `Er zijn ${gekoppeld.aantal} gebruikers aan deze club gekoppeld. Zet de club op inactief in plaats van ze te verwijderen.`,
    );
  }

  // Teams en wedstrijden verdwijnen mee via ON DELETE CASCADE.
  await env.DB.prepare('DELETE FROM clubs WHERE guid = ?').bind(guid).run();
  return json({ guid, verwijderd: true });
}

/**
 * POST /api/admin/teams   { actie: 'laden' }
 *
 * Haalt de teamlijst van elke actieve club op. Bestaande vinkjes blijven staan;
 * teams die niet meer voorkomen gaan op inactief in plaats van verwijderd te
 * worden, zodat historiek en ingevulde beschikbaarheden blijven bestaan.
 */
export async function teamsLaden({ request, env }) {
  const body = await leesJson(request);
  if (body.actie !== 'laden') return fout(400, 'Ongeldige aanvraag', "Enkel actie 'laden' bestaat.");

  const clubs = (await env.DB.prepare('SELECT guid, naam FROM clubs WHERE actief = 1').all()).results;
  if (clubs.length === 0) return fout(400, 'Geen clubs', 'Voeg eerst een club toe voor je teams laadt.');

  const rapport = {
    clubs: [],
    totaalGevonden: 0,
    totaalNieuw: 0,
    totaalInactief: 0,
    onbekendeCategorieen: [],
  };

  const gekend = new Set(
    (await env.DB.prepare('SELECT code FROM categorieen').all()).results.map((c) => c.code),
  );

  for (const club of clubs) {
    let detail;
    try {
      detail = await clubDetail(club.guid);
    } catch (err) {
      rapport.clubs.push({
        guid: club.guid,
        naam: club.naam,
        fout: err instanceof VblError ? err.message : String(err),
      });
      continue;
    }

    if (detail.teams.length === 0) {
      rapport.clubs.push({
        guid: club.guid,
        naam: detail.naam ?? club.naam,
        gevonden: 0,
        waarschuwing:
          'Geen teams herkend. Gebruik de controleknop met diagnose om de structuur te bekijken.',
      });
      continue;
    }

    const bestaandeGuids = new Set(
      (await env.DB.prepare('SELECT guid FROM teams WHERE club_guid = ?').bind(club.guid).all())
        .results.map((t) => t.guid),
    );
    const gevondenGuids = new Set(detail.teams.map((t) => t.guid));

    const opdrachten = [];

    if (detail.naam && detail.naam !== club.naam) {
      opdrachten.push(
        env.DB.prepare('UPDATE clubs SET naam = ? WHERE guid = ?').bind(detail.naam, club.guid),
      );
    }

    for (const team of detail.teams) {
      const catCode = categorieUitTeamGuid(team.guid, club.guid);

      // Een code die we niet kennen wordt gemeld, niet geraden. Anders belandt
      // een nieuwe reeks stilzwijgend in de verkeerde categorie — en dus aan
      // het verkeerde tarief.
      if (catCode && !gekend.has(catCode) && !rapport.onbekendeCategorieen.includes(catCode)) {
        rapport.onbekendeCategorieen.push(catCode);
      }

      opdrachten.push(
        env.DB.prepare(
          `INSERT INTO teams (guid, club_guid, naam, cat_code, cat_label, actief, laatst_gezien)
           VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
           ON CONFLICT (guid) DO UPDATE
             SET naam = excluded.naam, cat_code = excluded.cat_code,
                 cat_label = COALESCE(excluded.cat_label, teams.cat_label),
                 actief = 1, laatst_gezien = datetime('now')`,
        ).bind(team.guid, club.guid, team.naam, catCode, team.categorie ?? null),
      );
    }

    const verdwenen = [...bestaandeGuids].filter((g) => !gevondenGuids.has(g));
    for (const guid of verdwenen) {
      opdrachten.push(env.DB.prepare('UPDATE teams SET actief = 0 WHERE guid = ?').bind(guid));
    }

    await env.DB.batch(opdrachten);

    const nieuw = detail.teams.filter((t) => !bestaandeGuids.has(t.guid)).length;
    rapport.clubs.push({
      guid: club.guid,
      naam: detail.naam ?? club.naam,
      gevonden: detail.teams.length,
      nieuw,
      opInactief: verdwenen.length,
    });
    rapport.totaalGevonden += detail.teams.length;
    rapport.totaalNieuw += nieuw;
    rapport.totaalInactief += verdwenen.length;
  }

  return json(rapport);
}

/**
 * PATCH /api/admin/teams   { guid, yo, yoPlus }
 * YO aanvinken zet YO+ automatisch mee aan. Die regel wordt hier afgedwongen,
 * niet in de browser — en staat bovendien als CHECK in het schema.
 */
export async function teamVlaggen({ request, env }) {
  const body = await leesJson(request);
  const guid = typeof body.guid === 'string' ? body.guid : null;
  if (!guid) return fout(400, 'Ongeldige aanvraag', 'guid ontbreekt.');

  const yo = Boolean(body.yo);
  const yoPlus = yo ? true : Boolean(body.yoPlus);

  const bestaat = await env.DB.prepare('SELECT guid FROM teams WHERE guid = ?').bind(guid).first();
  if (!bestaat) return fout(404, 'Onbekend team', 'Dit team staat niet in de databank.');

  await env.DB.prepare('UPDATE teams SET yo = ?, yo_plus = ? WHERE guid = ?')
    .bind(yo ? 1 : 0, yoPlus ? 1 : 0, guid)
    .run();

  return json({ guid, yo, yoPlus });
}

/** POST /api/admin/sync — nu meteen synchroniseren. */
export async function syncNu({ env }) {
  return json(await synchroniseer(env.DB, 'handmatig'));
}

/** GET /api/admin/sync — de laatste tien runs en de openstaande wijzigingen. */
export async function syncLogboek({ env }) {
  const [runs, wijzigingen] = await Promise.all([
    env.DB.prepare(
      `SELECT gestart, geeindigd, bron, status, aantal_gevonden, aantal_nieuw,
              aantal_gewijzigd, aantal_verdwenen, boodschap
         FROM sync_runs ORDER BY id DESC LIMIT 10`,
    ).all(),
    env.DB.prepare(
      `SELECT c.id, c.match_guid, c.soort, c.veld, c.oud, c.nieuw, c.vastgesteld,
              m.datum, m.uur, m.thuis_naam, m.uit_naam
         FROM match_changes c
         LEFT JOIN matches m ON m.guid = c.match_guid
        WHERE c.afgehandeld = 0
        ORDER BY c.id DESC LIMIT 50`,
    ).all(),
  ]);

  return json({ runs: runs.results, wijzigingen: wijzigingen.results });
}
