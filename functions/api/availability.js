import { fout } from './_middleware.js';
import { seizoenscode } from '../_lib/vbl.js';

/**
 * POST /api/availability
 * body: { matchGuid: string, status: 'ja' | 'nee' | null }
 *
 * status null wist het antwoord, zodat een YO een vergissing kan terugdraaien
 * naar 'nog niet geantwoord'.
 *
 * De gebruiker komt uit data.user, nooit uit de body. En de wedstrijd moet er
 * één zijn die deze gebruiker ook echt te zien krijgt — anders zou iemand
 * beschikbaarheden kunnen zetten voor ploegen buiten zijn club of profiel.
 */
export async function onRequestPost({ request, data, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fout(400, 'Ongeldige aanvraag', 'Body moet JSON zijn.');
  }

  const { matchGuid, status } = body ?? {};

  if (typeof matchGuid !== 'string' || !matchGuid.trim()) {
    return fout(400, 'Ongeldige aanvraag', 'matchGuid ontbreekt.');
  }
  if (status !== 'ja' && status !== 'nee' && status !== null) {
    return fout(400, 'Ongeldige aanvraag', "status moet 'ja', 'nee' of null zijn.");
  }

  const { email, profiel, clubGuid } = data.user;
  if (!clubGuid) {
    return fout(403, 'Geen club', 'Je account is nog aan geen club gekoppeld.');
  }

  const instelling = await env.DB.prepare(
    `SELECT waarde FROM settings WHERE sleutel = 'seizoen_start_jaar'`,
  ).first();
  const seizoen = seizoenscode(Number(instelling?.waarde ?? 2026));
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

  return Response.json({ ok: true, matchGuid, status }, { headers: { 'Cache-Control': 'no-store' } });
}
