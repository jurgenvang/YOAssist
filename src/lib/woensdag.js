/**
 * De woensdagregel.
 *
 * Op woensdag om 14 uur wordt gekeken naar de wedstrijden van het eerstvolgende
 * weekend. Staan daar minder dan twee scheidsrechters van Basketbal Vlaanderen
 * op, dan komen ze in de aanduidingslijst voor YO+.
 *
 * Twee dingen die de regel bewust niet doet:
 *  - wedstrijden binnenhalen die een beheerder eerder uit de lijst heeft gezet
 *    (scope_uit); anders vecht de beheerder elke week tegen de automaat
 *  - iets doen met wedstrijden die al in de lijst staan
 */

/**
 * Het eerstvolgende weekend vanaf een gegeven dag, als [zaterdag, zondag].
 * Op woensdag is dat het weekend van diezelfde week.
 */
export function komendWeekend(vanaf) {
  const dag = vanaf.getUTCDay(); // 0 = zondag, 6 = zaterdag
  const naarZaterdag = (6 - dag + 7) % 7;
  const zaterdag = new Date(vanaf.getTime() + naarZaterdag * 86400000);
  const zondag = new Date(zaterdag.getTime() + 86400000);
  return [zaterdag.toISOString().slice(0, 10), zondag.toISOString().slice(0, 10)];
}

/**
 * @param {D1Database} db
 * @param {Date} nu
 * @returns {Promise<{gescoopt: number, wedstrijden: object[], van: string, tot: string}>}
 */
export async function pasWoensdagregelToe(db, nu = new Date()) {
  const [van, tot] = komendWeekend(nu);

  const { results: kandidaten } = await db
    .prepare(
      `SELECT m.guid, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.locatie, m.off_aantal,
              m.cat_code, cat.label AS cat_label
         FROM matches m
         LEFT JOIN categorieen cat ON cat.code = m.cat_code
        WHERE m.status = 'actief'
          AND m.scope = 0
          AND m.scope_uit = 0
          AND m.off_aantal < 2
          AND m.datum BETWEEN ? AND ?
        ORDER BY m.datum, m.uur, m.thuis_naam COLLATE NOCASE`,
    )
    .bind(van, tot)
    .all();

  if (kandidaten.length === 0) {
    return { gescoopt: 0, wedstrijden: [], van, tot };
  }

  const nuIso = nu.toISOString();
  await db.batch(
    kandidaten.map((k) =>
      db
        .prepare(
          `UPDATE matches SET scope = 1, scope_reden = 'woensdag', scope_op = ? WHERE guid = ?`,
        )
        .bind(nuIso, k.guid),
    ),
  );

  return {
    gescoopt: kandidaten.length,
    van,
    tot,
    wedstrijden: kandidaten.map((k) => ({
      guid: k.guid,
      datum: k.datum,
      uur: k.uur,
      thuis: k.thuis_naam,
      uit: k.uit_naam,
      locatie: k.locatie,
      catCode: k.cat_code,
      catLabel: k.cat_label,
      nogNodig: Math.max(0, 2 - k.off_aantal),
    })),
  };
}

/**
 * Avondcontrole: wedstrijden die via de woensdagregel in de lijst kwamen maar
 * intussen alsnog twee scheidsrechters van de bond hebben gekregen.
 *
 * Die worden niet automatisch uit de lijst gehaald. Er kan al iemand van ons
 * op staan of zich beschikbaar hebben gezet, en dat stil laten verdwijnen is
 * erger dan de beheerder een beslissing laten nemen.
 */
export async function zoekOverbodigeScope(db) {
  const vandaag = new Date().toISOString().slice(0, 10);

  const { results } = await db
    .prepare(
      `SELECT m.guid, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.off_aantal,
              (SELECT COUNT(*) FROM assignments a
                WHERE a.match_guid = m.guid AND a.status = 'toegewezen') AS eigen,
              (SELECT COUNT(*) FROM availability v WHERE v.match_guid = m.guid) AS antwoorden
         FROM matches m
        WHERE m.status = 'actief'
          AND m.scope = 1
          AND m.scope_reden = 'woensdag'
          AND m.off_aantal >= 2
          AND m.datum >= ?
        ORDER BY m.datum, m.uur`,
    )
    .bind(vandaag)
    .all();

  return results.map((r) => ({
    guid: r.guid,
    datum: r.datum,
    uur: r.uur,
    omschrijving: `${r.datum} ${r.uur} ${r.thuis_naam} - ${r.uit_naam}`,
    vblAantal: r.off_aantal,
    eigenToegewezen: r.eigen,
    antwoorden: r.antwoorden,
  }));
}
