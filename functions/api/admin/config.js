import { seizoenLabel, huidigSeizoenStartJaar } from '../../_lib/vbl.js';

/** GET /api/admin/config — alles wat het beheerscherm in één keer nodig heeft. */
export async function onRequestGet({ env }) {
  const db = env.DB;

  const seizoenRij = await db
    .prepare(`SELECT waarde FROM settings WHERE sleutel = 'seizoen_start_jaar'`)
    .first();
  const startJaar = Number(seizoenRij?.waarde ?? huidigSeizoenStartJaar());

  const [clubs, teams, laatsteSync, openWijzigingen] = await Promise.all([
    db.prepare('SELECT guid, naam, actief FROM clubs ORDER BY naam, guid').all(),
    db
      .prepare(
        `SELECT t.guid, t.club_guid, t.naam, t.yo, t.yo_plus, t.actief
           FROM teams t
          ORDER BY t.club_guid, t.naam`,
      )
      .all(),
    db
      .prepare(
        `SELECT gestart, geeindigd, bron, status, aantal_gevonden, aantal_nieuw,
                aantal_gewijzigd, aantal_verdwenen, boodschap
           FROM sync_runs ORDER BY id DESC LIMIT 1`,
      )
      .first(),
    db
      .prepare(`SELECT COUNT(*) AS aantal FROM match_changes WHERE afgehandeld = 0`)
      .first(),
  ]);

  return Response.json(
    {
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
        yo: t.yo === 1,
        yoPlus: t.yo_plus === 1,
        actief: t.actief === 1,
      })),
      laatsteSync,
      openWijzigingen: openWijzigingen?.aantal ?? 0,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
