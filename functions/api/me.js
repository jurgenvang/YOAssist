import { seizoenLabel } from '../_lib/vbl.js';

/** GET /api/me — wie ben ik, en wat mag ik zien. */
export async function onRequestGet({ data, env }) {
  const rij = await env.DB.prepare(`SELECT waarde FROM settings WHERE sleutel = 'seizoen_start_jaar'`).first();
  const startJaar = Number(rij?.waarde ?? 2026);

  return Response.json(
    {
      ...data.user,
      seizoen: seizoenLabel(startJaar),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
