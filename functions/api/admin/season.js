import { fout } from '../_middleware.js';
import { zetInstelling } from '../../_lib/sync.js';
import { seizoenLabel, huidigSeizoenStartJaar } from '../../_lib/vbl.js';

/**
 * POST /api/admin/season
 * body: { actie: 'omhoog' | 'omlaag' | 'volgDatum' } of { startJaar: 2027 }
 *
 * Een seizoen loopt van juli tot juni. 'volgDatum' zet het seizoen terug op wat
 * de kalender zegt, handig als er per ongeluk te ver is doorgeklikt.
 */
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fout(400, 'Ongeldige aanvraag', 'Body moet JSON zijn.');
  }

  const huidigeRij = await env.DB.prepare(
    `SELECT waarde FROM settings WHERE sleutel = 'seizoen_start_jaar'`,
  ).first();
  const huidig = Number(huidigeRij?.waarde ?? huidigSeizoenStartJaar());

  let nieuw;
  if (typeof body?.startJaar === 'number') {
    nieuw = Math.trunc(body.startJaar);
  } else if (body?.actie === 'omhoog') {
    nieuw = huidig + 1;
  } else if (body?.actie === 'omlaag') {
    nieuw = huidig - 1;
  } else if (body?.actie === 'volgDatum') {
    nieuw = huidigSeizoenStartJaar();
  } else {
    return fout(400, 'Ongeldige aanvraag', "Geef 'actie' of 'startJaar' mee.");
  }

  if (nieuw < 2000 || nieuw > 2100) {
    return fout(400, 'Ongeldig seizoen', 'Het startjaar ligt buiten een zinnig bereik.');
  }

  await zetInstelling(env.DB, 'seizoen_start_jaar', nieuw);

  return Response.json(
    { startJaar: nieuw, label: seizoenLabel(nieuw) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
