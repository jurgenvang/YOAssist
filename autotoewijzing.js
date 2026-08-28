/**
 * Regels rond aanduidingen.
 *
 * Apart gehouden van de routes omdat de automatische toewijzing later precies
 * dezelfde regels moet gebruiken. Twee implementaties van dezelfde regel lopen
 * gegarandeerd uit elkaar.
 */

/** Minuten tussen twee aanvangsuren in dezelfde zaal. */
export const MARGE_ZELFDE_ZAAL = 120;

/** Extra minuten bovenop de gewone marge bij een verplaatsing. */
export const MARGE_EXTRA_ANDERE_ZAAL = 30;

/** Hoeveel minuten voor de aanvang een official op het terrein wordt verwacht. */
export const OPKOMST_MINUTEN = 20;

/** Een basketbalwedstrijd heeft in principe twee scheidsrechters. */
export const REFS_PER_WEDSTRIJD = 2;

/**
 * Hoeveel eigen officials er nog gezocht worden.
 *
 * Basketbal Vlaanderen duidt er soms al één aan. Dan volstaat er nog één. Bij
 * U10/U12 duidt de bond er geen aan, dus komt dit vanzelf op twee uit.
 */
export function aantalNodig(offAantal) {
  return Math.max(0, REFS_PER_WEDSTRIJD - (Number(offAantal) || 0));
}

/** 'YYYY-MM-DD' + 'HH:MM' -> minuten sinds het begin van de tijdrekening. */
export function alsMinuten(datum, uur) {
  const [j, m, d] = String(datum).split('-').map(Number);
  const [u, min] = String(uur).split(':').map(Number);
  if (!j || !m || !d || Number.isNaN(u) || Number.isNaN(min)) return null;
  return Math.floor(Date.UTC(j, m - 1, d, u, min) / 60000);
}

/**
 * Botsen twee wedstrijden voor één persoon?
 *
 * Gemeten van aanvang tot aanvang: twee uur in dezelfde zaal, tweeënhalf uur
 * als hij zich moet verplaatsen. De locatie wordt op GUID vergeleken, niet op
 * naam — die laatste wordt niet overal identiek geschreven.
 */
export function botst(a, b) {
  const ta = alsMinuten(a.datum, a.uur);
  const tb = alsMinuten(b.datum, b.uur);
  if (ta === null || tb === null) return false;

  const zelfdeZaal = Boolean(a.accGuid) && a.accGuid === b.accGuid;
  const nodig = MARGE_ZELFDE_ZAAL + (zelfdeZaal ? 0 : MARGE_EXTRA_ANDERE_ZAAL);

  return Math.abs(ta - tb) < nodig;
}

/**
 * Zoekt botsingen tussen één wedstrijd en de wedstrijden waaraan iemand al is
 * toegewezen. Geeft de botsende wedstrijden terug, niet enkel true of false —
 * de beheerder wil weten wélke.
 */
export function conflicten(kandidaat, bestaande) {
  return bestaande.filter((b) => b.guid !== kandidaat.guid && botst(kandidaat, b));
}

/** 'HH:MM' minus de opkomsttijd. Voor de herinneringen, niet voor de conflictcontrole. */
export function opkomstUur(uur) {
  const [u, m] = String(uur).split(':').map(Number);
  if (Number.isNaN(u) || Number.isNaN(m)) return null;
  const totaal = (u * 60 + m - OPKOMST_MINUTEN + 1440) % 1440;
  return `${String(Math.floor(totaal / 60)).padStart(2, '0')}:${String(totaal % 60).padStart(2, '0')}`;
}
