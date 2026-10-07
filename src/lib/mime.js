/**
 * Een binnenkomende mail uitlezen, zonder bibliotheek (V39).
 *
 * Net genoeg MIME voor wat de app ontvangt: kopregels (met gecodeerde
 * woorden), multipart tot op willekeurige diepte, quoted-printable en base64,
 * en de tekensets die een Belgische nieuwsbrief gebruikt. Geen bijlagen, geen
 * HTML-weergave: we zoeken een link en lezen een afzender.
 *
 * Waarom zelf schrijven: de app heeft bewust geen buildstap en geen
 * afhankelijkheden, en wat hier nodig is, past in een paar functies.
 */

const tekst = new TextDecoder('utf-8');

function decodeerBytes(bytes, charset = 'utf-8') {
  try {
    return new TextDecoder(charset.toLowerCase().replace(/^"|"$/g, ''), { fatal: false }).decode(bytes);
  } catch {
    return tekst.decode(bytes);
  }
}

/** Quoted-printable naar bytes. '=\r\n' is een zachte regelbreuk. */
export function quotedPrintable(s) {
  const zonderZacht = s.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < zonderZacht.length; i++) {
    const c = zonderZacht[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(zonderZacht.slice(i + 1, i + 3))) {
      bytes.push(parseInt(zonderZacht.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      // Tekens buiten ASCII komen in een QP-deel niet voor, maar wie toch iets
      // ruw doorstuurt, mag zijn letters niet verliezen.
      for (const b of new TextEncoder().encode(c)) bytes.push(b);
    }
  }
  return new Uint8Array(bytes);
}

function base64(s) {
  const schoon = s.replace(/[^A-Za-z0-9+/=]/g, '');
  const bin = atob(schoon);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** '=?utf-8?Q?Wedstrijden=20zonder?=' naar 'Wedstrijden zonder'. */
export function gecodeerdeWoorden(s) {
  return String(s ?? '')
    // Witruimte tussen twee gecodeerde woorden hoort er niet bij (RFC 2047).
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, charset, soort, inhoud) => {
      const bytes = soort.toUpperCase() === 'B'
        ? base64(inhoud)
        : quotedPrintable(inhoud.replace(/_/g, ' '));
      return decodeerBytes(bytes, charset);
    });
}

/** Kopregels en romp scheiden; doorlopende kopregels samenvoegen. */
function splitsKop(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  const kopTekst = m ? raw.slice(0, m.index) : raw;
  const romp = m ? raw.slice(m.index + m[0].length) : '';

  const kop = {};
  for (const regel of kopTekst.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = regel.indexOf(':');
    if (i <= 0) continue;
    const naam = regel.slice(0, i).trim().toLowerCase();
    // De eerste telt: bij doorsturen kan een regel herhaald worden, en de
    // bovenste is dan die van de laatste schakel.
    if (!(naam in kop)) kop[naam] = regel.slice(i + 1).trim();
  }
  return { kop, romp };
}

/** 'text/plain; charset="utf-8"' naar { type, params }. */
function parameters(waarde = '') {
  const [type, ...rest] = waarde.split(';');
  const params = {};
  for (const p of rest) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    params[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return { type: type.trim().toLowerCase(), params };
}

function leesDeel(raw, tekstdelen, diepte = 0) {
  const { kop, romp } = splitsKop(raw);
  const { type, params } = parameters(kop['content-type'] ?? 'text/plain');

  if (type.startsWith('multipart/') && params.boundary && diepte < 10) {
    const grens = `--${params.boundary}`;
    for (const stuk of romp.split(grens).slice(1)) {
      if (stuk.startsWith('--')) break;   // de afsluitende grens
      leesDeel(stuk.replace(/^\r?\n/, ''), tekstdelen, diepte + 1);
    }
    return;
  }

  // Een doorgestuurde mail als bijlage: gewoon verder binnenin kijken.
  if (type === 'message/rfc822' && diepte < 10) {
    leesDeel(romp, tekstdelen, diepte + 1);
    return;
  }

  if (!type.startsWith('text/')) return;

  const codering = (kop['content-transfer-encoding'] ?? '7bit').toLowerCase();
  const bytes = codering === 'quoted-printable'
    ? quotedPrintable(romp)
    : codering === 'base64'
      ? base64(romp)
      : new TextEncoder().encode(romp);

  tekstdelen.push({ type, tekst: decodeerBytes(bytes, params.charset ?? 'utf-8') });
}

/**
 * @param {string} raw  de volledige mail zoals ontvangen
 * @returns {{kop: object, van: string, onderwerp: string, tekstdelen: {type: string, tekst: string}[]}}
 */
export function leesMail(raw) {
  const { kop } = splitsKop(raw);
  const tekstdelen = [];
  leesDeel(raw, tekstdelen);
  return {
    kop,
    van: gecodeerdeWoorden(kop.from ?? ''),
    onderwerp: gecodeerdeWoorden(kop.subject ?? ''),
    tekstdelen,
  };
}

/** Het e-mailadres uit 'Naam <adres>', in kleine letters. */
export function adresUit(van) {
  const m = String(van ?? '').match(/<([^>]+)>/);
  return (m ? m[1] : String(van ?? '')).trim().toLowerCase();
}
