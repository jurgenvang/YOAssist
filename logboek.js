/**
 * CSV lezen en schrijven.
 *
 * Bewust een eigen parser in plaats van een bibliotheek: de invoer komt van
 * mensen die een Excel-bestand exporteren, en dan zijn de eigenaardigheden
 * voorspelbaar — puntkomma's in plaats van komma's op een Belgische machine,
 * een BOM vooraan, aanhalingstekens rond velden met een komma erin, en
 * regeleindes van Windows.
 *
 * Alles hier is zuiver: geen databank, geen netwerk. De invoer is tekst en de
 * uitvoer zijn rijen, zodat elke rare invoer als test vast te leggen is.
 */

/** Detecteert of het bestand komma's of puntkomma's gebruikt als scheidingsteken. */
export function detecteerScheidingsteken(tekst) {
  const eersteRegel = tekst.split(/\r?\n/, 1)[0] ?? '';
  const komma = (eersteRegel.match(/,/g) ?? []).length;
  const punt = (eersteRegel.match(/;/g) ?? []).length;
  // Excel op een Belgische machine schrijft puntkomma's. Bij gelijkspel kiezen
  // we de komma, want dat is wat onze eigen sjablonen gebruiken.
  return punt > komma ? ';' : ',';
}

/**
 * Splitst één regel, met respect voor aanhalingstekens.
 * `a,"b,c",d` -> ['a', 'b,c', 'd']
 */
function splitsRegel(regel, scheiding) {
  const velden = [];
  let huidig = '';
  let inQuotes = false;

  for (let i = 0; i < regel.length; i++) {
    const teken = regel[i];

    if (inQuotes) {
      if (teken === '"') {
        // Twee aanhalingstekens na elkaar zijn één letterlijk aanhalingsteken.
        if (regel[i + 1] === '"') { huidig += '"'; i++; }
        else inQuotes = false;
      } else {
        huidig += teken;
      }
      continue;
    }

    if (teken === '"') inQuotes = true;
    else if (teken === scheiding) { velden.push(huidig); huidig = ''; }
    else huidig += teken;
  }

  velden.push(huidig);
  return velden.map((v) => v.trim());
}

/**
 * @returns {{kolommen: string[], rijen: object[], scheiding: string}}
 */
export function leesCsv(ruw) {
  const tekst = String(ruw ?? '').replace(/^\uFEFF/, '');
  const scheiding = detecteerScheidingsteken(tekst);

  const regels = tekst
    .split(/\r?\n/)
    .filter((r) => r.trim() !== '');

  if (regels.length === 0) return { kolommen: [], rijen: [], scheiding };

  const kolommen = splitsRegel(regels[0], scheiding).map((k) => k.toLowerCase());

  const rijen = regels.slice(1).map((regel, i) => {
    const velden = splitsRegel(regel, scheiding);
    const rij = { _regel: i + 2 }; // +2: de kop is regel 1
    kolommen.forEach((kolom, j) => {
      rij[kolom] = velden[j] ?? '';
    });
    return rij;
  });

  return { kolommen, rijen, scheiding };
}

/** Bouwt een CSV-tekst. Velden met een scheidingsteken of quote worden omsloten. */
export function maakCsv(kolommen, rijen, scheiding = ',') {
  const veld = (waarde) => {
    const s = String(waarde ?? '');
    return /["\n\r]|[,;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  return [
    kolommen.join(scheiding),
    ...rijen.map((r) => kolommen.map((k) => veld(r[k])).join(scheiding)),
  ].join('\n');
}

/** Leest een 'ja'/'1'/'true'-achtige waarde uit een CSV-veld. */
export function alsBoolean(waarde) {
  const s = String(waarde ?? '').trim().toLowerCase();
  return ['1', 'ja', 'j', 'true', 'waar', 'x', 'y', 'yes'].includes(s);
}
