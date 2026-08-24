/** Kleine hulpjes die elke route gebruikt. */

const GEEN_CACHE = { 'Cache-Control': 'no-store' };

export function json(body, status = 200) {
  return Response.json(body, { status, headers: GEEN_CACHE });
}

export function fout(status, titel, detail) {
  return json({ error: titel, detail }, status);
}

/** Leest de body als JSON, of gooit een Response die je meteen kunt teruggeven. */
export async function leesJson(request) {
  try {
    const body = await request.json();
    if (body === null || typeof body !== 'object') throw new Error('geen object');
    return body;
  } catch {
    throw fout(400, 'Ongeldige aanvraag', 'Body moet een JSON-object zijn.');
  }
}

/** Haalt één instelling op. */
export async function instelling(db, sleutel, standaard = null) {
  const rij = await db.prepare('SELECT waarde FROM settings WHERE sleutel = ?').bind(sleutel).first();
  return rij ? rij.waarde : standaard;
}
