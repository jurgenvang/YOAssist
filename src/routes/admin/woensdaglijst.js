import { json } from '../../lib/http.js';

/**
 * GET /api/admin/woensdaglijst — de laatst ontvangen woensdaglijsten (V39).
 *
 * Vooral om na te gaan of de lijst binnenkomt: bij het instellen van Email
 * Routing en het doorsturen is dit de enige plek waar je kan zien of het werkt,
 * zonder op woensdag 14 uur te moeten wachten.
 */
export async function overzicht({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, ontvangen, onderwerp, weekend_van, weekend_tot, aantal_rijen, eigen, meldingen,
            status, fout, verwerkt_op
       FROM vbl_lijsten ORDER BY id DESC LIMIT 8`,
  ).all();

  const telling = (s, sleutel) => {
    try { return (JSON.parse(s ?? '{}')[sleutel] ?? []).length; } catch { return 0; }
  };

  return json({
    lijsten: results.map((r) => ({
      id: r.id,
      ontvangen: r.ontvangen,
      onderwerp: r.onderwerp,
      van: r.weekend_van,
      tot: r.weekend_tot,
      aantalRijen: r.aantal_rijen,
      aantalEigen: (() => { try { return JSON.parse(r.eigen ?? '[]').length; } catch { return 0; } })(),
      nietGekoppeld: telling(r.meldingen, 'nietGekoppeld'),
      status: r.status,
      fout: r.fout,
      verwerktOp: r.verwerkt_op,
    })),
  });
}
