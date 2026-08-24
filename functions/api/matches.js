import { seizoenscode } from '../_lib/vbl.js';

/**
 * GET /api/matches — thuiswedstrijden voor de aangemelde Youth Official.
 *
 * Filtering:
 *  - alleen het actieve seizoen
 *  - alleen wedstrijden van de club waar de gebruiker bij hoort
 *  - alleen teams die voor zijn profiel aangevinkt staan
 *    (YO ziet teams.yo = 1, YO+ ziet teams.yo_plus = 1)
 *  - alleen wedstrijden vanaf vandaag, en niet de verdwenen
 *
 * De frontend groepeert per maand; sorteren gebeurt hier op datum, uur, ploeg.
 */
export async function onRequestGet({ data, env }) {
  const { email, profiel, clubGuid } = data.user;

  const instelling = await env.DB.prepare(
    `SELECT waarde FROM settings WHERE sleutel = 'seizoen_start_jaar'`,
  ).first();
  const seizoen = seizoenscode(Number(instelling?.waarde ?? 2026));

  if (!clubGuid) {
    return Response.json(
      { seizoen, matches: [], waarschuwing: 'Je account is nog aan geen club gekoppeld.' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const vlagKolom = profiel === 'YO+' ? 't.yo_plus' : 't.yo';
  const vandaag = new Date().toISOString().slice(0, 10);

  const { results } = await env.DB.prepare(
    `SELECT m.guid, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.locatie, m.poule_naam,
            a.status AS beschikbaarheid
       FROM matches m
       JOIN teams t ON t.guid = m.thuis_guid
       LEFT JOIN availability a ON a.match_guid = m.guid AND a.user_email = ?
      WHERE m.seizoen = ?
        AND m.status = 'actief'
        AND m.club_guid = ?
        AND ${vlagKolom} = 1
        AND t.actief = 1
        AND m.datum >= ?
      ORDER BY m.datum, m.uur, m.thuis_naam`,
  )
    .bind(email, seizoen, clubGuid, vandaag)
    .all();

  const matches = results.map((r) => ({
    guid: r.guid,
    datum: r.datum,
    uur: r.uur,
    thuis: r.thuis_naam,
    uit: r.uit_naam,
    locatie: r.locatie,
    poule: r.poule_naam,
    beschikbaarheid: r.beschikbaarheid ?? null,
  }));

  return Response.json({ seizoen, matches }, { headers: { 'Cache-Control': 'no-store' } });
}
