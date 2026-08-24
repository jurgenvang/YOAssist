import { identify, AuthError } from '../_lib/access.js';

/**
 * Draait vóór elke route onder /api/. Zet context.data.user met een identiteit
 * die de client niet kan vervalsen. Alles daarna leest de gebruiker uitsluitend
 * uit data.user — nooit uit de request body of een gewone header.
 */
export async function onRequest(context) {
  const { request, env, next, data } = context;

  let identiteit;
  try {
    identiteit = await identify(request, env);
  } catch (err) {
    const boodschap = err instanceof AuthError ? err.message : 'authenticatie mislukt';
    return fout(401, 'Niet aangemeld', boodschap);
  }

  const rij = await env.DB.prepare(
    `SELECT u.email, u.naam, u.is_admin, u.profiel, u.club_guid, u.actief, c.naam AS club_naam
       FROM users u
       LEFT JOIN clubs c ON c.guid = u.club_guid
      WHERE u.email = ?`,
  )
    .bind(identiteit.email)
    .first();

  if (!rij) {
    return fout(
      403,
      'Niet in de ledenlijst',
      `${identiteit.email} raakt wel door Access maar staat niet in YOAssist.`,
    );
  }
  if (!rij.actief) {
    return fout(403, 'Account niet actief', 'Neem contact op met een beheerder.');
  }

  data.user = {
    email: rij.email,
    naam: rij.naam,
    isAdmin: rij.is_admin === 1,
    profiel: rij.profiel,
    clubGuid: rij.club_guid,
    clubNaam: rij.club_naam,
    via: identiteit.via,
  };

  return next();
}

export function fout(status, titel, detail) {
  return Response.json(
    { error: titel, detail },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
