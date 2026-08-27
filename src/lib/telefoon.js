/**
 * Telefoonnummers.
 *
 * Mensen typen een nummer op tien manieren: met spaties, streepjes, punten,
 * haakjes, met of zonder landcode. Voor het tonen laten we dat grotendeels met
 * rust — herkenbaarheid telt daar — maar voor een WhatsApp-link moet het één
 * vorm zijn: enkel cijfers, met landcode, zonder plusteken.
 *
 * Standaard België. Wie een buitenlands nummer heeft, tikt het met + en dan
 * blijft die landcode staan.
 */

const STANDAARD_LANDCODE = '32';

/** Alles weg wat geen cijfer is, behalve een plusteken vooraan. */
function alleenCijfers(ruw) {
  const s = String(ruw ?? '').trim();
  const plus = s.startsWith('+');
  return (plus ? '+' : '') + s.replace(/[^\d]/g, '');
}

/**
 * Zet een nummer om naar het formaat dat wa.me verwacht: landcode plus nummer,
 * zonder plusteken en zonder scheidingstekens.
 *
 * @returns {string|null} null als er geen bruikbaar nummer in zit
 */
export function naarInternationaal(ruw, landcode = STANDAARD_LANDCODE) {
  const s = alleenCijfers(ruw);
  const cijfers = s.replace('+', '');

  // Te kort om een echt nummer te zijn. Zes is ruim; Belgische mobiele nummers
  // hebben er negen na de landcode.
  if (cijfers.length < 6) return null;

  // Al internationaal getikt: met + ervoor, of met 00 ervoor.
  if (s.startsWith('+')) return cijfers;
  if (cijfers.startsWith('00')) return cijfers.slice(2);

  // Nationaal met een voorloopnul: die vervalt bij een landcode.
  if (cijfers.startsWith('0')) return landcode + cijfers.slice(1);

  // Begint het al met de landcode, dan staat het er al goed.
  if (cijfers.startsWith(landcode)) return cijfers;

  return landcode + cijfers;
}

/** De volledige wa.me-link, of null als het nummer onbruikbaar is. */
export function whatsappLink(ruw, landcode = STANDAARD_LANDCODE) {
  const nummer = naarInternationaal(ruw, landcode);
  return nummer ? `https://wa.me/${nummer}` : null;
}

/**
 * Leesbaar maken voor op het scherm: Belgische mobiele nummers in de vorm
 * 0470 12 34 56. Herkent het patroon niet, dan blijft het nummer zoals het
 * getikt is — een verkeerde opmaak is verwarrender dan geen opmaak.
 */
export function toonNummer(ruw) {
  const s = String(ruw ?? '').trim();
  if (!s) return '';

  const cijfers = s.replace(/[^\d]/g, '');

  // 0470123456 of 32470123456
  const nationaal = cijfers.startsWith('32') && cijfers.length === 11
    ? '0' + cijfers.slice(2)
    : cijfers;

  if (/^04\d{8}$/.test(nationaal)) {
    return `${nationaal.slice(0, 4)} ${nationaal.slice(4, 6)} ${nationaal.slice(6, 8)} ${nationaal.slice(8)}`;
  }

  return s;
}

/** Is dit iets dat op een telefoonnummer lijkt? Voor invoercontrole. */
export function geldigNummer(ruw) {
  if (!ruw || String(ruw).trim() === '') return true;   // leeg mag
  return naarInternationaal(ruw) !== null;
}
