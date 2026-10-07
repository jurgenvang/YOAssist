/**
 * Een .xlsx uitlezen, zonder bibliotheek (V39).
 *
 * Een xlsx is een zip met XML erin. Dit leest het eerste werkblad als een
 * lijst rijen, met per cel de waarde én of ze een vulkleur heeft. Dat laatste
 * is geen detail: in de woensdaglijst van Basketbal Vlaanderen betekent een
 * grijze cel bij 'Official 1' of 'Official 2' dat daar iemand is aangeduid,
 * zonder dat er een naam staat.
 *
 * Uitpakken gebeurt met DecompressionStream('deflate-raw'), dat zowel in een
 * Worker als in Node bestaat. De XML wordt met reguliere expressies gelezen:
 * een Worker heeft geen DOMParser, en de stukken die we nodig hebben (rijen,
 * cellen, gedeelde teksten, stijlen) hebben een vaste, eenvoudige vorm.
 */

/** De bestanden in een zip, als { pad: Uint8Array }. */
export async function pakUit(buffer, enkel = null) {
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Het einde van de centrale map zoeken, van achter naar voor: er kan een
  // commentaar achter staan.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Geen geldig zip-bestand.');

  const aantal = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const bestanden = {};

  for (let n = 0; n < aantal; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Beschadigde zip-inhoud.');
    const methode = dv.getUint16(p + 10, true);
    const gecomprimeerd = dv.getUint32(p + 20, true);
    const naamLengte = dv.getUint16(p + 28, true);
    const extraLengte = dv.getUint16(p + 30, true);
    const commentaarLengte = dv.getUint16(p + 32, true);
    const lokaal = dv.getUint32(p + 42, true);
    const naam = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + naamLengte));
    p += 46 + naamLengte + extraLengte + commentaarLengte;

    if (enkel && !enkel(naam)) continue;

    // De lokale kop kan een andere extra-lengte hebben dan de centrale.
    const start = lokaal + 30 + dv.getUint16(lokaal + 26, true) + dv.getUint16(lokaal + 28, true);
    const data = bytes.subarray(start, start + gecomprimeerd);

    if (methode === 0) {
      bestanden[naam] = data;
    } else if (methode === 8) {
      const stroom = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bestanden[naam] = new Uint8Array(await new Response(stroom).arrayBuffer());
    } else {
      throw new Error(`Onbekende zip-compressie (${methode}) voor ${naam}.`);
    }
  }
  return bestanden;
}

const ENTITEITEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function ontsnap(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (heel, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : heel;
    }
    return ENTITEITEN[e] ?? heel;
  });
}

function attr(tag, naam) {
  const m = tag.match(new RegExp(`\\s${naam}="([^"]*)"`));
  return m ? ontsnap(m[1]) : null;
}

/** Alle tekst binnen <t>…</t>, ook bij opgemaakte stukken (<r><t>). */
function teksten(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)]
    .map((m) => ontsnap(m[1] ?? '')).join('');
}

/** 'AB' naar 27 (0-gebaseerd: A = 0). */
function kolomIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Per stijlnummer: de vulkleur, of null als de cel niet gevuld is. */
function leesStijlen(xml) {
  if (!xml) return [];
  const fillsBlok = xml.match(/<fills[^>]*>([\s\S]*?)<\/fills>/)?.[1] ?? '';
  const fills = [...fillsBlok.matchAll(/<fill>([\s\S]*?)<\/fill>|<fill\/>/g)].map((m) => {
    const inhoud = m[1] ?? '';
    const patroon = inhoud.match(/<patternFill[^>]*>/)?.[0] ?? '';
    if (attr(patroon, 'patternType') !== 'solid') return null;
    const fg = inhoud.match(/<fgColor[^>]*\/?>/)?.[0] ?? '';
    return attr(fg, 'rgb') ?? (attr(fg, 'theme') !== null ? `thema:${attr(fg, 'theme')}` : 'onbekend');
  });

  const xfsBlok = xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  return [...xfsBlok.matchAll(/<xf\b[^>]*>/g)].map((m) => fills[Number(attr(m[0], 'fillId') ?? 0)] ?? null);
}

/**
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {Promise<{blad: string, rijen: {waarde: string, kleur: string|null}[][]}>}
 */
export async function leesXlsx(buffer) {
  const bestanden = await pakUit(buffer, (n) => n.startsWith('xl/') && n.endsWith('.xml')
    || n === 'xl/_rels/workbook.xml.rels');
  const lees = (pad) => (bestanden[pad] ? new TextDecoder().decode(bestanden[pad]) : null);

  const werkboek = lees('xl/workbook.xml');
  if (!werkboek) throw new Error('Geen werkboek gevonden in het bestand.');

  // Het eerste werkblad, via de relaties; sheet1.xml als terugval.
  const eerste = werkboek.match(/<sheet\b[^>]*>/)?.[0] ?? '';
  const bladNaam = attr(eerste, 'name') ?? '';
  const relId = attr(eerste, 'r:id');
  const rels = lees('xl/_rels/workbook.xml.rels') ?? '';
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0])
    .find((r) => attr(r, 'Id') === relId);
  const doel = rel ? attr(rel, 'Target').replace(/^\/?(xl\/)?/, 'xl/') : 'xl/worksheets/sheet1.xml';

  const blad = lees(doel) ?? lees('xl/worksheets/sheet1.xml');
  if (!blad) throw new Error('Het werkblad ontbreekt in het bestand.');

  const gedeeld = [...(lees('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => teksten(m[1]));
  const stijlen = leesStijlen(lees('xl/styles.xml'));

  const rijen = [];
  for (const rij of blad.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const cellen = [];
    for (const c of (rij[1] ?? '').matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const kop = ` ${c[1] ?? c[2]}`;
      const inhoud = c[3] ?? '';
      const ref = attr(kop, 'r');
      const soort = attr(kop, 't');
      const v = inhoud.match(/<v>([\s\S]*?)<\/v>/)?.[1];

      let waarde = '';
      if (soort === 's' && v !== undefined) waarde = gedeeld[Number(v)] ?? '';
      else if (soort === 'inlineStr') waarde = teksten(inhoud);
      else if (v !== undefined) waarde = ontsnap(v);

      const kleur = stijlen[Number(attr(kop, 's') ?? 0)] ?? null;
      const index = ref ? kolomIndex(ref) : cellen.length;
      cellen[index] = { waarde: waarde.trim(), kleur };
    }
    for (let i = 0; i < cellen.length; i++) cellen[i] ??= { waarde: '', kleur: null };
    rijen.push(cellen);
  }

  return { blad: bladNaam, rijen };
}
