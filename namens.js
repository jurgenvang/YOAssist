/**
 * Schrijven naar het logboek.
 *
 * Eén plaats waar de vorm van een logregel wordt bepaald. Elke route die iets
 * wijzigt gaat hierlangs, zodat het logboek één consistent verhaal blijft in
 * plaats van een verzameling losse schrijfstijlen.
 *
 * `regel()` geeft een voorbereid statement terug in plaats van het meteen uit
 * te voeren. Wie al een batch aan het opbouwen is — de synchronisatie
 * bijvoorbeeld — kan het daarin meenemen; wie dat niet doet gebruikt `log()`.
 */

const SQL = `INSERT INTO logboek (categorie, soort, match_guid, wie, veld, oud, nieuw, afgehandeld)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * @param {D1Database} db
 * @param {object} g gebeurtenis
 * @param {'wedstrijd'|'aanduiding'|'beheer'} g.categorie
 * @param {string} g.soort
 * @param {string} [g.matchGuid]
 * @param {string} [g.wie] e-mailadres, of 'systeem' voor de cron
 * @param {string} [g.veld]
 * @param {string} [g.oud]
 * @param {string} [g.nieuw]
 * @param {boolean} [g.afgehandeld] beheeracties staan meteen op afgehandeld:
 *   daar valt niets op te volgen
 */
export function regel(db, g) {
  const afgehandeld = g.afgehandeld ?? g.categorie === 'beheer';

  return db
    .prepare(SQL)
    .bind(
      g.categorie,
      g.soort,
      g.matchGuid ?? null,
      g.wie ?? 'systeem',
      g.veld ?? null,
      g.oud ?? null,
      g.nieuw ?? null,
      afgehandeld ? 1 : 0,
    );
}

/** Schrijft één regel meteen weg. Faalt stil: loggen mag nooit de actie breken. */
export async function log(db, g) {
  try {
    await regel(db, g).run();
  } catch (err) {
    console.error('[YOAssist] logregel mislukt:', err.message, g);
  }
}

/** Korte omschrijving van een wedstrijd, voor in de logregels. */
export function wedstrijdOmschrijving(w) {
  if (!w) return null;
  const datum = w.datum ?? w.datum_iso ?? '';
  const uur = w.uur ?? '';
  const thuis = w.thuis_naam ?? w.thuisNaam ?? '';
  const uit = w.uit_naam ?? w.uitNaam ?? '';
  return `${datum} ${uur} ${thuis} - ${uit}`.trim();
}
