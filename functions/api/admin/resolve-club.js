import { fout } from '../_middleware.js';
import { clubDetail, normaliseerGuid, CLUB_GUID_PATROON, VblError } from '../../_lib/vbl.js';

/**
 * GET /api/admin/resolve-club?guid=BVBL1053
 *
 * Controleknop achter het GUID-veld: haalt de clubnaam en de teamlijst op
 * zonder iets te bewaren. Zo weet de beheerder meteen of hij de juiste club te
 * pakken heeft.
 *
 * ?diagnose=1 geeft daarbovenop een fragment van de ruwe respons terug. Dat is
 * bedoeld voor het geval de teamherkenning niets vindt: dan kunnen we zien hoe
 * de respons er werkelijk uitziet in plaats van te gokken.
 */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const guid = normaliseerGuid(url.searchParams.get('guid') ?? '').toUpperCase();
  const diagnose = url.searchParams.get('diagnose') === '1';

  if (!CLUB_GUID_PATROON.test(guid)) {
    return fout(400, 'Ongeldige GUID', 'Een club-GUID heeft de vorm BVBL gevolgd door vier cijfers.');
  }

  let detail;
  try {
    detail = await clubDetail(guid);
  } catch (err) {
    const boodschap = err instanceof VblError ? err.message : String(err);
    return fout(502, 'Basketbal Vlaanderen', boodschap);
  }

  const bestaat = await env.DB.prepare('SELECT guid FROM clubs WHERE guid = ?').bind(guid).first();

  const antwoord = {
    guid,
    naam: detail.naam,
    aantalTeams: detail.teams.length,
    teams: detail.teams.slice(0, 100),
    reedsToegevoegd: Boolean(bestaat),
  };

  if (!detail.naam || detail.teams.length === 0) {
    antwoord.waarschuwing =
      'De naam of de teamlijst kon niet herkend worden in het antwoord. ' +
      'Vraag de diagnose op om te zien hoe de respons is opgebouwd.';
  }

  if (diagnose) {
    antwoord.diagnose = {
      sleutelsOpTopniveau: Array.isArray(detail.rauw)
        ? `array van ${detail.rauw.length}`
        : Object.keys(detail.rauw ?? {}),
      fragment: JSON.stringify(detail.rauw).slice(0, 4000),
    };
  }

  return Response.json(antwoord, { headers: { 'Cache-Control': 'no-store' } });
}
