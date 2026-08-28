import { json, fout, leesJson } from '../../lib/http.js';
import { synchroniseerVolgClubs } from '../../lib/volgsync.js';
import { clubDetail } from '../../lib/vbl.js';
import { log } from '../../lib/logboek.js';

/**
 * De aandachtspagina (V31): wedstrijden bij gevolgde clubs met nul of één
 * scheidsrechter. Een apart, uitzetbaar scherm — standaard uit, net als het
 * logboek — met een eigen, kleine synchronisatie los van de hoofdcyclus.
 */

/** GET /api/admin/volg-clubs — de lijst van gevolgde clubs. */
export async function lijst({ env }) {
  const { results } = await env.DB
    .prepare('SELECT guid, naam, toegevoegd_door, toegevoegd FROM volg_clubs ORDER BY naam COLLATE NOCASE')
    .all();
  return json({ clubs: results });
}

/** POST /api/admin/volg-clubs   { guid } */
export async function toevoegen({ request, env, user }) {
  const body = await leesJson(request);
  const guid = String(body.guid ?? '').trim().toUpperCase();

  if (!guid) return fout(400, 'Geen GUID', 'Vul de club-GUID in, bijvoorbeeld BVBL1053.');

  const bestaat = await env.DB.prepare('SELECT guid FROM volg_clubs WHERE guid = ?').bind(guid).first();
  if (bestaat) return fout(409, 'Al gevolgd', `${guid} staat al in de lijst.`);

  let naam = null;
  try {
    const detail = await clubDetail(guid);
    naam = detail.naam;
  } catch {
    // Een club die (nog) niet op te halen is, mag je toch alvast toevoegen —
    // de eerstvolgende synchronisatie probeert het opnieuw.
  }

  await env.DB.prepare(
    'INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES (?, ?, ?)',
  ).bind(guid, naam, user.email).run();

  await log(env.DB, {
    categorie: 'beheer', soort: 'volgclub', wie: user.email,
    veld: 'club toegevoegd aan aandachtspagina', nieuw: `${guid}${naam ? ` (${naam})` : ''}`,
  });

  return json({ guid, naam });
}

/** DELETE /api/admin/volg-clubs?guid=… */
export async function verwijderen({ url, env, user }) {
  const guid = String(url.searchParams.get('guid') ?? '').trim().toUpperCase();
  if (!guid) return fout(400, 'Geen GUID', 'guid ontbreekt.');

  const res = await env.DB.prepare('DELETE FROM volg_clubs WHERE guid = ?').bind(guid).run();

  await log(env.DB, {
    categorie: 'beheer', soort: 'volgclub', wie: user.email,
    veld: 'club verwijderd van aandachtspagina', oud: guid,
  });

  return json({ guid, verwijderd: res?.meta?.changes ?? 0 });
}

/**
 * GET /api/admin/aandacht
 *
 * De wedstrijden van de komende twee weekends bij gevolgde clubs, met nul of
 * één scheidsrechter aangeduid door de bond.
 */
export async function aandacht({ env }) {
  const vandaag = new Date();
  const tot = new Date(vandaag.getTime() + 14 * 86400000);
  const vandaagIso = vandaag.toISOString().slice(0, 10);
  const totIso = tot.toISOString().slice(0, 10);

  const { results } = await env.DB.prepare(
    `SELECT guid, club_guid, club_naam, thuis_naam, uit_naam, datum, uur, vbl_aantal
       FROM volg_wedstrijden
      WHERE datum BETWEEN ? AND ? AND vbl_aantal <= 1
      ORDER BY datum, uur, club_naam COLLATE NOCASE`,
  )
    .bind(vandaagIso, totIso)
    .all();

  const { results: clubs } = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM volg_clubs')
    .all();

  return json({
    aantal: results.length,
    aantalClubs: clubs[0]?.n ?? 0,
    wedstrijden: results.map((r) => ({
      guid: r.guid,
      clubGuid: r.club_guid,
      clubNaam: r.club_naam,
      wedstrijd: `${r.thuis_naam} - ${r.uit_naam}`,
      datum: r.datum,
      uur: r.uur,
      aantalRefs: r.vbl_aantal,
    })),
  });
}

/** POST /api/admin/aandacht/sync — handmatig synchroniseren, los van de cron. */
export async function syncNu({ env, user }) {
  const rapport = await synchroniseerVolgClubs(env.DB);

  await log(env.DB, {
    categorie: 'beheer', soort: 'volgclub', wie: user.email,
    veld: 'aandachtspagina gesynchroniseerd',
    nieuw: `${rapport.clubs} clubs, ${rapport.gevonden} wedstrijden${
      rapport.fouten.length ? `, fouten: ${rapport.fouten.join(' | ')}` : ''}`,
  });

  return json(rapport);
}
