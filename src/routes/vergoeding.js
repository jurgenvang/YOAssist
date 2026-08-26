import { json, instelling } from '../lib/http.js';
import { seizoenscode } from '../lib/vbl.js';
import { maandBereik, maandVan, perOfficial, alsBedrag } from '../lib/vergoeding.js';

/**
 * GET /api/vergoeding — het eigen overzicht van een official.
 *
 * Recentste maand bovenaan, historiek eronder. De lopende maand staat er ook
 * bij, met de vermelding dat er nog niets vastligt. Zonder die regel komt de
 * vraag 'ik heb vorige week gefloten, waarom staat er niets' bij de beheerder
 * terecht, en dat is precies wat een overzicht moet voorkomen.
 */
export async function vergoeding({ env, user }) {
  const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));

  // ---- Afgesloten maanden -------------------------------------------------
  const { results: regels } = await env.DB.prepare(
    `SELECT r.*, a.afgesloten_op
       FROM vergoeding_regels r
       JOIN afgesloten_maanden a ON a.maand = r.maand
      WHERE r.user_email = ?
      ORDER BY r.maand DESC, r.soort DESC, r.betreft_maand, r.cat_code`,
  )
    .bind(user.email)
    .all();

  const perMaand = new Map();
  for (const r of regels) {
    const bestaand = perMaand.get(r.maand) ?? {
      maand: r.maand,
      afgeslotenOp: r.afgesloten_op,
      afgesloten: true,
      regels: [],
      totaalCent: 0,
      aantalWedstrijden: 0,
    };
    bestaand.regels.push({
      soort: r.soort,
      betreftMaand: r.betreft_maand,
      catCode: r.cat_code,
      catLabel: r.cat_label,
      aantal: r.aantal,
      tariefCent: r.tarief_cent,
      bedragCent: r.bedrag_cent,
      bedrag: alsBedrag(r.bedrag_cent),
    });
    bestaand.totaalCent += r.bedrag_cent;
    bestaand.aantalWedstrijden += r.aantal;
    perMaand.set(r.maand, bestaand);
  }

  // ---- De lopende maand, en eerdere die nog niet afgesloten zijn ----------
  const { results: afgesloten } = await env.DB.prepare(
    'SELECT maand FROM afgesloten_maanden',
  ).all();
  const afgeslotenSet = new Set(afgesloten.map((a) => a.maand));

  const vandaag = new Date().toISOString().slice(0, 10);

  const { results: lopend } = await env.DB.prepare(
    `SELECT m.datum, m.cat_code, c.label AS cat_label, c.tarief_cent
       FROM assignments a
       JOIN matches m ON m.guid = a.match_guid
       LEFT JOIN categorieen c ON c.code = m.cat_code
      WHERE a.status = 'toegewezen' AND a.user_email = ?
        AND m.status = 'actief' AND m.seizoen = ? AND m.datum <= ?
      ORDER BY m.datum`,
  )
    .bind(user.email, seizoen, vandaag)
    .all();

  const nogNiet = new Map();
  for (const r of lopend) {
    const maand = maandVan(r.datum);
    if (afgeslotenSet.has(maand)) continue;
    if (r.tarief_cent === null || r.tarief_cent === undefined) continue;

    const bestaand = nogNiet.get(maand) ?? {
      maand,
      afgesloten: false,
      regels: new Map(),
      totaalCent: 0,
      aantalWedstrijden: 0,
    };

    const bestaandeRegel = bestaand.regels.get(r.cat_code) ?? {
      soort: 'wedstrijd',
      betreftMaand: null,
      catCode: r.cat_code,
      catLabel: r.cat_label,
      aantal: 0,
      tariefCent: r.tarief_cent,
      bedragCent: 0,
    };
    bestaandeRegel.aantal += 1;
    bestaandeRegel.bedragCent += r.tarief_cent;
    bestaand.regels.set(r.cat_code, bestaandeRegel);

    bestaand.totaalCent += r.tarief_cent;
    bestaand.aantalWedstrijden += 1;
    nogNiet.set(maand, bestaand);
  }

  const lopendeMaanden = [...nogNiet.values()].map((m) => ({
    ...m,
    regels: [...m.regels.values()].map((r) => ({ ...r, bedrag: alsBedrag(r.bedragCent) })),
    totaal: alsBedrag(m.totaalCent),
  }));

  const maanden = [
    ...lopendeMaanden,
    ...[...perMaand.values()].map((m) => ({ ...m, totaal: alsBedrag(m.totaalCent) })),
  ].sort((a, b) => b.maand.localeCompare(a.maand));

  const seizoenTotaal = [...perMaand.values()].reduce((s, m) => s + m.totaalCent, 0);

  return json({
    seizoen,
    maanden,
    // Enkel wat vastligt telt mee in het seizoenstotaal; de lopende maand kan
    // nog wijzigen en zou het cijfer misleidend maken.
    seizoenTotaalCent: seizoenTotaal,
    seizoenTotaal: alsBedrag(seizoenTotaal),
    aantalAfgesloten: perMaand.size,
  });
}
