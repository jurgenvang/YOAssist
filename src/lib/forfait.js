/**
 * Forfait verwerken (V40).
 *
 * Krijgt een wedstrijd een forfait terwijl er iemand van de club op staat,
 * dan beslist de instelling `forfait_aanduiding` wat er gebeurt:
 *  - 'vrijgeven' (standaard): de aanduiding vervalt automatisch, maar enkel als
 *    het forfait vóór de wedstrijddag bekend is. Dan gaat de wedstrijd zeker
 *    niet door, en hoort de official dat op tijd.
 *  - 'melden': de aanduiding blijft staan; de beheerders beslissen.
 *
 * Een forfait dat pas op de dag zelf of achteraf verschijnt, wordt nooit
 * automatisch vrijgegeven: de official kan al ter plaatse geweest zijn, en dan
 * is het aan de beheerder om te beslissen of er een vergoeding tegenover staat.
 */

import { instelling } from './http.js';
import { log, wedstrijdOmschrijving } from './logboek.js';
import { maandVan } from './vergoeding.js';
import { templateForfaitVrijgegeven, templateForfaitBeheer } from './mailer.js';
import { verwittig, verwittigAllen } from './verwittigen.js';

/**
 * @param {object} env
 * @param {{guid: string, datum: string}[]} nieuwe  rapport.nieuweForfaits uit de sync
 * @param {Date} [nu]
 */
export async function verwerkForfaits(env, nieuwe, nu = new Date()) {
  const uitkomst = { vrijgegeven: [], teBekijken: [] };
  if (!nieuwe?.length) return uitkomst;

  const vandaag = nu.toISOString().slice(0, 10);
  const modus = await instelling(env.DB, 'forfait_aanduiding', 'vrijgeven');
  const { results: afgesloten } = await env.DB.prepare('SELECT maand FROM afgesloten_maanden').all();
  const afgeslotenMaanden = new Set(afgesloten.map((a) => a.maand));

  for (const f of nieuwe) {
    // Per wedstrijd één query: zo blijft het onder de honderd gebonden
    // parameters van D1, hoeveel forfaits er ook tegelijk binnenkomen.
    const { results: aanduidingen } = await env.DB.prepare(
      `SELECT a.user_email, u.voornaam, u.achternaam,
              m.datum, m.uur, m.thuis_naam, m.uit_naam
         FROM assignments a
         JOIN users u ON u.email = a.user_email
         JOIN matches m ON m.guid = a.match_guid
        WHERE a.match_guid = ? AND a.status = 'toegewezen'`,
    )
      .bind(f.guid)
      .all();
    if (aanduidingen.length === 0) continue;

    const m = aanduidingen[0];
    const vooraf = m.datum > vandaag;

    // Een voorbij forfait in een maand die al afgesloten is: de vergoeding
    // ligt vast en een rechtzetting zou via een correctie moeten. Dat zit ook
    // in de eerste synchronisatie na de invoering, voor het hele seizoen —
    // de beheerders daar nu mee lastigvallen is ruis.
    if (!vooraf && afgeslotenMaanden.has(maandVan(m.datum))) continue;

    const wedstrijd = `${m.thuis_naam} - ${m.uit_naam}`;
    const item = {
      guid: f.guid,
      datum: m.datum,
      uur: m.uur,
      wedstrijd,
      officials: aanduidingen.map((a) => `${a.voornaam} ${a.achternaam}`),
    };

    if (!(vooraf && modus === 'vrijgeven')) {
      uitkomst.teBekijken.push(item);
      continue;
    }

    for (const a of aanduidingen) {
      await env.DB.prepare(
        `UPDATE assignments SET status = 'vrijgegeven', gewijzigd_op = datetime('now')
          WHERE match_guid = ? AND user_email = ? AND status = 'toegewezen'`,
      )
        .bind(f.guid, a.user_email)
        .run();

      await log(env.DB, {
        categorie: 'aanduiding',
        soort: 'vrijgegeven',
        matchGuid: f.guid,
        wie: 'systeem',
        veld: wedstrijdOmschrijving(m),
        oud: `${a.voornaam} ${a.achternaam} (forfait)`,
      });

      await verwittig(env, a.user_email, templateForfaitVrijgegeven({
        naam: `${a.voornaam} ${a.achternaam}`,
        wedstrijd,
        datum: m.datum,
        uur: m.uur,
        matchGuid: f.guid,
      })).catch(() => ({ mail: false }));
    }
    uitkomst.vrijgegeven.push(item);
  }

  if (uitkomst.vrijgegeven.length || uitkomst.teBekijken.length) {
    const { results: beheerders } = await env.DB
      .prepare('SELECT email FROM users WHERE is_admin = 1 AND actief = 1')
      .all();
    await verwittigAllen(env, beheerders.map((b) => b.email), templateForfaitBeheer(uitkomst))
      .catch(() => {});
  }

  return uitkomst;
}
