import { json, fout, leesJson } from '../lib/http.js';

/**
 * Mijn berichten en de mededelingen.
 *
 * Een official ziet hier wat de app hem gestuurd heeft. Wat een beheerder
 * namens de club naar anderen stuurt, staat niet hier maar in het logboek —
 * anders zou dezelfde actie op twee plaatsen opduiken.
 */

/** GET /api/berichten — wat deze gebruiker ontving, nieuwste eerst. */
export async function berichten({ url, env, user }) {
  const limiet = Math.min(Math.max(Number(url.searchParams.get('limiet') ?? 100) || 100, 1), 300);

  const { results } = await env.DB.prepare(
    `SELECT b.id, b.soort, b.titel, b.tekst, b.match_guid, b.verstuurd, b.kanalen, b.gelezen_op,
            m.datum, m.uur, m.thuis_naam, m.uit_naam
       FROM berichten b
       LEFT JOIN matches m ON m.guid = b.match_guid
      WHERE b.user_email = ?
      ORDER BY b.id DESC
      LIMIT ${limiet}`,
  )
    .bind(user.email)
    .all();

  return json({
    aantal: results.length,
    ongelezen: results.filter((r) => !r.gelezen_op).length,
    berichten: results.map((r) => ({
      id: r.id,
      soort: r.soort,
      titel: r.titel,
      tekst: r.tekst,
      verstuurd: r.verstuurd,
      gelezen: Boolean(r.gelezen_op),
      kanalen: (r.kanalen ?? '').split(',').filter(Boolean),
      // De wedstrijd wordt nu opgehaald, niet bewaard: verschuift ze, dan klopt
      // het bericht nog steeds.
      wedstrijd: r.datum ? `${r.datum} ${r.uur} ${r.thuis_naam} - ${r.uit_naam}` : null,
      matchGuid: r.match_guid,
    })),
  });
}

/**
 * PATCH /api/berichten/gelezen?id=…
 *
 * Pas gezet bij het individueel aanklikken van een bericht — niet automatisch
 * bij het openen of sluiten van het paneel, zodat iemand eerst kan scannen
 * zonder dat de stipjes meteen verdwijnen.
 */
export async function markeerGelezen({ url, env, user }) {
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id)) return fout(400, 'Ongeldige aanvraag', 'id ontbreekt.');

  const res = await env.DB.prepare(
    `UPDATE berichten SET gelezen_op = datetime('now')
      WHERE id = ? AND user_email = ? AND gelezen_op IS NULL`,
  )
    .bind(id, user.email)
    .run();

  return json({ id, gewijzigd: res?.meta?.changes ?? 0 });
}

/** PATCH /api/berichten/alles-gelezen — alles van deze gebruiker in één keer. */
export async function markeerAllesGelezen({ env, user }) {
  const res = await env.DB.prepare(
    `UPDATE berichten SET gelezen_op = datetime('now')
      WHERE user_email = ? AND gelezen_op IS NULL`,
  )
    .bind(user.email)
    .run();

  return json({ gewijzigd: res?.meta?.changes ?? 0 });
}

/** DELETE /api/berichten?id=… — wegvegen. */
export async function verwijder({ url, env, user }) {
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id)) return fout(400, 'Ongeldige aanvraag', 'id ontbreekt.');

  const res = await env.DB
    .prepare('DELETE FROM berichten WHERE id = ? AND user_email = ?')
    .bind(id, user.email)
    .run();

  return json({ id, verwijderd: res?.meta?.changes ?? 0 });
}

/** GET /api/berichten/ongelezen — enkel de teller, licht genoeg voor de kopbalk. */
export async function ongelezen({ env, user }) {
  const rij = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM berichten WHERE user_email = ? AND gelezen_op IS NULL')
    .bind(user.email)
    .first();
  return json({ ongelezen: rij?.n ?? 0 });
}

/**
 * GET /api/mededeling — de actieve mededeling, of niets.
 *
 * Weggeklikt of verlopen betekent hetzelfde voor de ontvanger: geen banner.
 * Het verschil is dat verlopen voor iedereen geldt en wegklikken per persoon.
 */
export async function mededeling({ env, user }) {
  const rij = await env.DB.prepare(
    `SELECT m.id, m.tekst, m.link, m.link_tekst, m.geldig_tot, m.gezet_op
       FROM mededelingen m
      WHERE m.actief = 1
        AND m.geldig_tot > datetime('now')
        AND NOT EXISTS (
          SELECT 1 FROM mededeling_gezien g
           WHERE g.mededeling_id = m.id AND g.user_email = ?)
      ORDER BY m.id DESC
      LIMIT 1`,
  )
    .bind(user.email)
    .first();

  return json({ mededeling: rij ?? null });
}

/** POST /api/mededeling/wegklikken   { id } */
export async function wegklikken({ request, env, user }) {
  const body = await leesJson(request);
  const id = Number(body.id);
  if (!Number.isInteger(id)) return fout(400, 'Ongeldige aanvraag', 'id ontbreekt.');

  await env.DB.prepare(
    `INSERT INTO mededeling_gezien (mededeling_id, user_email) VALUES (?, ?)
     ON CONFLICT (mededeling_id, user_email) DO NOTHING`,
  )
    .bind(id, user.email)
    .run();

  return json({ id, weggeklikt: true });
}
