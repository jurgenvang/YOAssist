import { fout } from '../_middleware.js';
import { clubDetail, normaliseerGuid, CLUB_GUID_PATROON, VblError } from '../../_lib/vbl.js';

/**
 * POST   /api/admin/clubs        { guid }            voeg een club toe
 * PATCH  /api/admin/clubs        { guid, actief }    zet aan of uit
 * DELETE /api/admin/clubs?guid=  verwijdert de club, haar teams en wedstrijden
 */

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fout(400, 'Ongeldige aanvraag', 'Body moet JSON zijn.');
  }

  const guid = normaliseerGuid(body?.guid ?? '').toUpperCase();
  if (!CLUB_GUID_PATROON.test(guid)) {
    return fout(400, 'Ongeldige GUID', 'Een club-GUID heeft de vorm BVBL gevolgd door vier cijfers.');
  }

  // Naam ophalen als controle. Lukt dat niet, dan voegen we de club wel toe —
  // een tijdelijke storing bij Wisseq mag geen blokkade zijn.
  let naam = null;
  let waarschuwing = null;
  try {
    const detail = await clubDetail(guid);
    naam = detail.naam;
  } catch (err) {
    waarschuwing =
      err instanceof VblError
        ? `Club toegevoegd, maar de naam kon niet opgehaald worden: ${err.message}`
        : 'Club toegevoegd, maar de naam kon niet opgehaald worden.';
  }

  await env.DB.prepare(
    `INSERT INTO clubs (guid, naam, actief) VALUES (?, ?, 1)
     ON CONFLICT (guid) DO UPDATE SET naam = COALESCE(excluded.naam, clubs.naam), actief = 1`,
  )
    .bind(guid, naam)
    .run();

  return Response.json({ guid, naam, waarschuwing }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPatch({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fout(400, 'Ongeldige aanvraag', 'Body moet JSON zijn.');
  }

  const guid = normaliseerGuid(body?.guid ?? '').toUpperCase();
  if (!CLUB_GUID_PATROON.test(guid)) return fout(400, 'Ongeldige GUID', 'Onbekende clubvorm.');
  if (typeof body?.actief !== 'boolean') {
    return fout(400, 'Ongeldige aanvraag', 'actief moet true of false zijn.');
  }

  await env.DB.prepare('UPDATE clubs SET actief = ? WHERE guid = ?')
    .bind(body.actief ? 1 : 0, guid)
    .run();

  return Response.json({ guid, actief: body.actief }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
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

  return Response.json({ guid, verwijderd: true }, { headers: { 'Cache-Control': 'no-store' } });
}
