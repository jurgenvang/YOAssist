import { json, fout, leesJson } from '../../lib/http.js';
import { templateVulNogIn } from '../../lib/mailer.js';
import { verwittig } from '../../lib/verwittigen.js';
import { log } from '../../lib/logboek.js';

/**
 * Herinnering voor wie nog niet heeft ingevuld voor een gekozen weekend.
 *
 * Anders dan de automatische herinneringen (die gaan over wie al aangeduid is
 * en morgen fluit): dit gaat over wie voor geen enkele wedstrijd van het
 * weekend een beschikbaarheid heeft opgegeven. Een aanvulling naast de
 * bestaande herinneringen, geen vervanging.
 *
 * Bewust geen droogloop — dit is een gerichte actie die een beheerder zelf
 * initieert voor een klein aantal mensen, anders dan de welkomstmail of een
 * mededeling die naar de hele club gaat.
 */

/**
 * POST /api/admin/vul-nog-in   { zaterdag: 'YYYY-MM-DD' }
 *
 * 'zaterdag' bepaalt het weekend: die dag zelf en de zondag erna.
 */
export async function verstuur({ request, env, user }) {
  const body = await leesJson(request);
  const zaterdag = String(body.zaterdag ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(zaterdag)) {
    return fout(400, 'Geen datum', 'Kies een zaterdag om het weekend te bepalen.');
  }

  const zondag = new Date(`${zaterdag}T00:00:00Z`);
  zondag.setUTCDate(zondag.getUTCDate() + 1);
  const zondagIso = zondag.toISOString().slice(0, 10);

  // Alle wedstrijden van dat weekend die in de aanduidingslijst staan.
  const { results: wedstrijden } = await env.DB.prepare(
    `SELECT m.guid, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.club_guid
       FROM matches m
      WHERE m.status = 'actief' AND m.scope = 1
        AND m.datum IN (?, ?)
      ORDER BY m.datum, m.uur, m.thuis_naam COLLATE NOCASE`,
  )
    .bind(zaterdag, zondagIso)
    .all();

  if (wedstrijden.length === 0) {
    return fout(404, 'Niets te herinneren', 'Er staan geen wedstrijden voor dat weekend.');
  }

  const guids = wedstrijden.map((w) => w.guid);
  const clubGuids = [...new Set(wedstrijden.map((w) => w.club_guid))];

  // Iedereen die voor minstens één wedstrijd van dat weekend al iets invulde.
  const { results: beantwoord } = await env.DB.prepare(
    `SELECT DISTINCT user_email FROM availability
      WHERE match_guid IN (${guids.map(() => '?').join(',')})`,
  )
    .bind(...guids)
    .all();
  const heeftGeantwoord = new Set(beantwoord.map((r) => r.user_email));

  // Alle actieve officials van de betrokken clubs.
  const { results: officials } = await env.DB.prepare(
    `SELECT email, voornaam, achternaam FROM users
      WHERE actief = 1 AND club_guid IN (${clubGuids.map(() => '?').join(',')})`,
  )
    .bind(...clubGuids)
    .all();

  const teHerinneren = officials.filter((o) => !heeftGeantwoord.has(o.email));

  if (teHerinneren.length === 0) {
    return json({ verstuurd: 0, aantal: 0, boodschap: 'Iedereen heeft al geantwoord.' });
  }

  const van = zaterdag;
  const tot = zondagIso;
  const wedstrijdenTekst = wedstrijden.map((w) => ({
    datum: w.datum, uur: w.uur, thuis: w.thuis_naam, uit: w.uit_naam,
  }));

  let verstuurd = 0;
  for (const o of teHerinneren) {
    const bericht = templateVulNogIn({
      naam: `${o.voornaam} ${o.achternaam}`,
      wedstrijden: wedstrijdenTekst,
      van,
      tot,
    });
    const res = await verwittig(env, o.email, bericht).catch(() => ({ mail: false, push: 0 }));
    if (res.mail || res.push > 0) verstuurd++;
  }

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'herinnering',
    wie: user.email,
    veld: `herinnering 'nog in te vullen' verstuurd (${verstuurd} van ${teHerinneren.length})`,
    nieuw: `weekend ${van} — ${tot}: ${teHerinneren.map((o) => o.email).join(', ')}`,
  });

  return json({ verstuurd, aantal: teHerinneren.length });
}
