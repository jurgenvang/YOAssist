import { json, fout, leesJson, instelling } from '../lib/http.js';
import { seizoenLabel, seizoenscode } from '../lib/vbl.js';

/** GET /api/me — wie ben ik, en wat mag ik zien. */
export async function me({ env, user }) {
  const startJaar = Number(await instelling(env.DB, 'seizoen_start_jaar', '2026'));
  return json({ ...user, seizoen: seizoenLabel(startJaar) });
}

/**
 * GET /api/matches — thuiswedstrijden voor de aangemelde Youth Official.
 *
 * Filtering: actief seizoen, eigen club, teams die voor zijn profiel
 * aangevinkt staan (YO ziet teams.yo, YO+ ziet teams.yo_plus), niet verdwenen,
 * en vanaf vandaag. Sortering op datum, uur, ploeg; de frontend groepeert per
 * maand.
 */
export async function matches({ env, user }) {
  const { email, profiel, clubGuid } = user;
  const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));

  if (!clubGuid) {
    return json({
      seizoen,
      matches: [],
      waarschuwing: 'Je account is nog aan geen club gekoppeld.',
    });
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

  return json({
    seizoen,
    matches: results.map((r) => ({
      guid: r.guid,
      datum: r.datum,
      uur: r.uur,
      thuis: r.thuis_naam,
      uit: r.uit_naam,
      locatie: r.locatie,
      poule: r.poule_naam,
      beschikbaarheid: r.beschikbaarheid ?? null,
    })),
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
  const vlagKolom = profiel === 'YO+' ? 't.yo_plus' : 't.yo';

  const toegestaan = await env.DB.prepare(
    `SELECT m.guid
       FROM matches m
       JOIN teams t ON t.guid = m.thuis_guid
      WHERE m.guid = ? AND m.seizoen = ? AND m.status = 'actief'
        AND m.club_guid = ? AND ${vlagKolom} = 1 AND t.actief = 1`,
  )
    .bind(matchGuid, seizoen, clubGuid)
    .first();

  if (!toegestaan) {
    return fout(404, 'Wedstrijd niet gevonden', 'Deze wedstrijd staat niet in jouw lijst.');
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
