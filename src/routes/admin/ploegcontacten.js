import { json, fout, leesJson } from '../../lib/http.js';
import { leesCsv, maakCsv } from '../../lib/csv.js';
import { log } from '../../lib/logboek.js';
import {
  SOORTEN, KOLOMMEN, gevolgdeTeams, contactenPerTeam, sjabloonRijen, planImport, voerImportUit,
} from '../../lib/ploegcontacten.js';

/**
 * Beheer van ploegverantwoordelijken en coaches (V34). Twee lijsten, dezelfde
 * routes: `soort` is 'pv' of 'coach'.
 */

function soortUit(waarde) {
  return Object.hasOwn(SOORTEN, waarde) ? waarde : null;
}

/** GET /api/admin/ploegcontacten?soort=pv|coach — per gevolgde ploeg wie erop staat. */
export async function lijst({ url, env }) {
  const soort = soortUit(url.searchParams.get('soort'));
  if (!soort) return fout(400, 'Onbekende lijst', "soort is 'pv' of 'coach'.");

  const teams = await gevolgdeTeams(env.DB);
  const perTeam = await contactenPerTeam(env.DB, soort);
  return json({
    soort,
    teams: teams.map((t) => ({
      guid: t.guid,
      naam: t.naam,
      personen: (perTeam.get(t.guid) ?? []).map((p) => ({
        voornaam: p.voornaam, achternaam: p.achternaam, email: p.email,
      })),
    })),
  });
}

/**
 * GET /api/admin/ploegcontacten/sjabloon?soort=pv|coach
 *
 * Anders dan het sjabloon voor gebruikers: dit is al ingevuld met elke
 * gevolgde ploeg en wie er al op staat, zodat het de lijst zelf is die je
 * bijwerkt en weer inleest.
 */
export async function sjabloon({ url, env }) {
  const soort = soortUit(url.searchParams.get('soort'));
  if (!soort) return fout(400, 'Onbekende lijst', "soort is 'pv' of 'coach'.");

  const rijen = sjabloonRijen(await gevolgdeTeams(env.DB), await contactenPerTeam(env.DB, soort));
  return new Response(maakCsv(KOLOMMEN, rijen), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${SOORTEN[soort].bestand}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * POST /api/admin/ploegcontacten/import   { soort, csv, uitvoeren?: boolean }
 *
 * Standaard een droogloop: tonen wat er per ploeg zou veranderen. Pas met
 * `uitvoeren` wordt het weggeschreven.
 */
export async function importeer({ request, env, user }) {
  const body = await leesJson(request);
  const soort = soortUit(body.soort);
  if (!soort) return fout(400, 'Onbekende lijst', "soort is 'pv' of 'coach'.");

  const { kolommen, rijen } = leesCsv(body.csv);
  if (rijen.length === 0) return fout(400, 'Leeg bestand', 'Er staan geen gegevensregels in dit bestand.');

  const ontbrekend = [
    ['voornaam'], ['e-mail', 'email'], ['team'],
  ].filter((namen) => !namen.some((n) => kolommen.includes(n))).map((namen) => namen[0]);
  if (ontbrekend.length > 0) {
    return fout(400, 'Kolommen ontbreken',
      `Deze kolom${ontbrekend.length > 1 ? 'men ontbreken' : ' ontbreekt'}: ${ontbrekend.join(', ')}. ` +
      `Verwacht: ${KOLOMMEN.join(', ')}.`);
  }

  const plan = planImport(await gevolgdeTeams(env.DB), await contactenPerTeam(env.DB, soort), rijen);
  const uitvoeren = body.uitvoeren === true;

  if (uitvoeren && plan.wijzigingen.length > 0) {
    await voerImportUit(env.DB, soort, plan.wijzigingen);
    const tel = (sleutel) => plan.wijzigingen.reduce((n, w) => n + w[sleutel].length, 0);
    await log(env.DB, {
      categorie: 'beheer', soort: 'ploegcontacten', wie: user.email,
      veld: `${SOORTEN[soort].label} ingelezen`,
      nieuw: `${plan.wijzigingen.length} ploeg(en): ${tel('nieuw')} erbij, ${tel('weg')} eruit`,
    });
  }

  return json({ soort, uitgevoerd: uitvoeren, ...plan });
}
