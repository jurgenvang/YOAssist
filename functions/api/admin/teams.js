import { fout } from '../_middleware.js';
import { clubDetail, VblError } from '../../_lib/vbl.js';

/**
 * POST  /api/admin/teams   { actie: 'laden' }
 *       Haalt de teamlijst van elke actieve club op bij Basketbal Vlaanderen.
 *       Bestaande vinkjes blijven behouden; teams die niet meer voorkomen
 *       worden op inactief gezet in plaats van verwijderd, zodat historiek en
 *       reeds ingevulde beschikbaarheden blijven staan.
 *
 * PATCH /api/admin/teams   { guid, yo, yoPlus }
 *       Zet de vlaggen. YO aanvinken zet YO+ automatisch mee aan; YO+ uitvinken
 *       zet YO automatisch mee uit. Die regel wordt hier afgedwongen, niet in
 *       de browser.
 */

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fout(400, 'Ongeldige aanvraag', 'Body moet JSON zijn.');
  }

  if (body?.actie !== 'laden') {
    return fout(400, 'Ongeldige aanvraag', "Enkel actie 'laden' is ondersteund.");
  }

  const clubs = (await env.DB.prepare('SELECT guid, naam FROM clubs WHERE actief = 1').all()).results;
  if (clubs.length === 0) {
    return fout(400, 'Geen clubs', 'Voeg eerst een club toe voor je teams laadt.');
  }

  const rapport = { clubs: [], totaalGevonden: 0, totaalNieuw: 0, totaalInactief: 0 };

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
          'Geen teams herkend in het antwoord. Gebruik de controleknop met diagnose om de structuur te bekijken.',
      });
      continue;
    }

    const bestaande = (
      await env.DB.prepare('SELECT guid FROM teams WHERE club_guid = ?').bind(club.guid).all()
    ).results;
    const bestaandeGuids = new Set(bestaande.map((t) => t.guid));
    const gevondenGuids = new Set(detail.teams.map((t) => t.guid));

    const opdrachten = [];

    if (detail.naam && detail.naam !== club.naam) {
      opdrachten.push(env.DB.prepare('UPDATE clubs SET naam = ? WHERE guid = ?').bind(detail.naam, club.guid));
    }

    for (const team of detail.teams) {
      opdrachten.push(
        env.DB
          .prepare(
            `INSERT INTO teams (guid, club_guid, naam, actief, laatst_gezien)
             VALUES (?, ?, ?, 1, datetime('now'))
             ON CONFLICT (guid) DO UPDATE
               SET naam = excluded.naam, actief = 1, laatst_gezien = datetime('now')`,
          )
          .bind(team.guid, club.guid, team.naam),
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

  return Response.json(rapport, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPatch({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fout(400, 'Ongeldige aanvraag', 'Body moet JSON zijn.');
  }

  const guid = typeof body?.guid === 'string' ? body.guid : null;
  if (!guid) return fout(400, 'Ongeldige aanvraag', 'guid ontbreekt.');

  let yo = Boolean(body?.yo);
  let yoPlus = Boolean(body?.yoPlus);

  // De regel uit de specificatie: YO impliceert YO+.
  if (yo) yoPlus = true;

  const bestaat = await env.DB.prepare('SELECT guid FROM teams WHERE guid = ?').bind(guid).first();
  if (!bestaat) return fout(404, 'Onbekend team', 'Dit team staat niet in de databank.');

  await env.DB.prepare('UPDATE teams SET yo = ?, yo_plus = ? WHERE guid = ?')
    .bind(yo ? 1 : 0, yoPlus ? 1 : 0, guid)
    .run();

  return Response.json({ guid, yo, yoPlus }, { headers: { 'Cache-Control': 'no-store' } });
}
