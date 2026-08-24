import { synchroniseer } from '../../_lib/sync.js';

/**
 * POST /api/admin/sync — draait de synchronisatie nu meteen.
 * GET  /api/admin/sync — de laatste tien runs en de openstaande wijzigingen.
 */

export async function onRequestPost({ env }) {
  const rapport = await synchroniseer(env.DB, 'handmatig');
  return Response.json(rapport, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestGet({ env }) {
  const [runs, wijzigingen] = await Promise.all([
    env.DB
      .prepare(
        `SELECT gestart, geeindigd, bron, status, aantal_gevonden, aantal_nieuw,
                aantal_gewijzigd, aantal_verdwenen, boodschap
           FROM sync_runs ORDER BY id DESC LIMIT 10`,
      )
      .all(),
    env.DB
      .prepare(
        `SELECT c.id, c.match_guid, c.soort, c.veld, c.oud, c.nieuw, c.vastgesteld,
                m.datum, m.uur, m.thuis_naam, m.uit_naam
           FROM match_changes c
           LEFT JOIN matches m ON m.guid = c.match_guid
          WHERE c.afgehandeld = 0
          ORDER BY c.id DESC LIMIT 50`,
      )
      .all(),
  ]);

  return Response.json(
    { runs: runs.results, wijzigingen: wijzigingen.results },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
