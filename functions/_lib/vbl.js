/**
 * Client voor de Basketbal Vlaanderen (Wisseq) API.
 *
 * De API is ongedocumenteerd en de vorm van de responses staat niet vast. Alles
 * hier is daarom defensief: we zoeken naar herkenbare patronen in plaats van
 * vaste velden aan te nemen, en we geven bij twijfel de ruwe structuur terug
 * zodat het beheerscherm kan tonen wat er misging.
 */

const BASIS = 'http://vblcb.wisseq.eu/VBLCB_WebService/data';

export class VblError extends Error {}

/** Club-GUID: BVBL gevolgd door exact vier cijfers. */
export const CLUB_GUID_PATROON = /^BVBL\d{4}$/;

export function normaliseerGuid(guid) {
  if (typeof guid !== 'string') return '';
  let g = guid.trim().replace(/#$/, '');
  if (g.includes('%')) {
    try {
      g = decodeURIComponent(g);
    } catch {
      /* laat staan zoals het is */
    }
  }
  return g.replace(/\+/g, ' ');
}

async function haal(pad, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASIS}/${pad}?${qs}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 60, cacheEverything: false },
    });
  } catch (err) {
    throw new VblError(`Basketbal Vlaanderen niet bereikbaar: ${err.message}`);
  }

  if (!res.ok) {
    throw new VblError(`Basketbal Vlaanderen antwoordde met status ${res.status}`);
  }

  // Responses kunnen een BOM hebben; JSON.parse struikelt daarover.
  const tekst = (await res.text()).replace(/^\uFEFF/, '').trim();
  if (!tekst) throw new VblError('Leeg antwoord van Basketbal Vlaanderen');

  try {
    return JSON.parse(tekst);
  } catch {
    throw new VblError(`Antwoord is geen geldige JSON (begint met: ${tekst.slice(0, 60)})`);
  }
}

// ---------------------------------------------------------------------------
// Structuurherkenning
// ---------------------------------------------------------------------------

/** Loopt recursief door een JSON-structuur en levert elk object op. */
function* alleObjecten(knoop, diepte = 0) {
  if (diepte > 8 || knoop === null || typeof knoop !== 'object') return;
  if (Array.isArray(knoop)) {
    for (const item of knoop) yield* alleObjecten(item, diepte + 1);
    return;
  }
  yield knoop;
  for (const waarde of Object.values(knoop)) yield* alleObjecten(waarde, diepte + 1);
}

/** Eerste stringwaarde uit een object waarvan de sleutel op een naam wijst. */
function vindNaam(obj, sleutelPatroon = /naam|name|oms/i) {
  for (const [sleutel, waarde] of Object.entries(obj)) {
    if (typeof waarde !== 'string') continue;
    if (!waarde.trim()) continue;
    if (/guid|id$/i.test(sleutel)) continue;
    if (sleutelPatroon.test(sleutel)) return waarde.trim();
  }
  return null;
}

/**
 * Haalt de teams uit een OrgDetailByGuid-respons.
 *
 * Een team-GUID begint met de club-GUID en heeft daarna nog tekens
 * (categorie + volgnummer), bijvoorbeeld 'BVBL1053J16  1'. Daarop filteren we,
 * ongeacht in welke tak van de respons ze zitten.
 */
export function extraheerTeams(json, clubGuid) {
  const gevonden = new Map();

  for (const obj of alleObjecten(json)) {
    for (const [sleutel, waarde] of Object.entries(obj)) {
      if (typeof waarde !== 'string') continue;
      if (!/guid/i.test(sleutel)) continue;

      const guid = waarde.trim();
      if (!guid.startsWith(clubGuid) || guid.length <= clubGuid.length) continue;

      const naam = vindNaam(obj) || guid.slice(clubGuid.length).trim();
      if (!gevonden.has(guid)) gevonden.set(guid, { guid, naam });
    }
  }

  return [...gevonden.values()].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

/** Haalt de clubnaam uit een OrgDetailByGuid-respons. */
export function extraheerClubNaam(json) {
  for (const obj of alleObjecten(json)) {
    const naam = vindNaam(obj, /^(org|club)?naam$|^naam$|^orgNaam$|^clubNaam$/i);
    if (naam && naam.length > 2) return naam;
  }
  for (const obj of alleObjecten(json)) {
    const naam = vindNaam(obj);
    if (naam && naam.length > 2) return naam;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Normalisatie van wedstrijdvelden
// ---------------------------------------------------------------------------

/** 'dd-mm-yyyy' -> 'yyyy-mm-dd'. Geeft null bij een onherkenbare waarde. */
export function normaliseerDatum(datumString) {
  if (typeof datumString !== 'string') return null;
  const m = datumString.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) {
    // Sommige records geven al ISO terug.
    const iso = datumString.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  const [, d, mnd, j] = m;
  return `${j}-${mnd.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** '10.30' of '10:30' -> '10:30'. */
export function normaliseerUur(beginTijd) {
  if (typeof beginTijd !== 'string') return null;
  const m = beginTijd.trim().match(/^(\d{1,2})[.:h](\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/**
 * Seizoenscode uit een wedstrijd-GUID.
 * 'BVBL26279170INJ1621FAB' -> '2627'
 */
export function seizoenUitGuid(guid) {
  if (typeof guid !== 'string') return null;
  const m = guid.match(/^BVBL(\d{4})/);
  return m ? m[1] : null;
}

/** Startjaar 2026 -> seizoenscode '2627'. */
export function seizoenscode(startJaar) {
  const a = String(startJaar).slice(-2);
  const b = String(Number(startJaar) + 1).slice(-2);
  return `${a}${b}`;
}

/** Startjaar 2026 -> '2026-2027'. */
export function seizoenLabel(startJaar) {
  return `${startJaar}-${Number(startJaar) + 1}`;
}

/**
 * Het seizoen dat op een bepaalde datum loopt. Een seizoen start in juli.
 * Gebruikt de Belgische kalender, niet UTC.
 */
export function huidigSeizoenStartJaar(nu = new Date()) {
  const fmt = new Intl.DateTimeFormat('nl-BE', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: 'numeric',
  });
  const delen = Object.fromEntries(fmt.formatToParts(nu).map((p) => [p.type, p.value]));
  const jaar = Number(delen.year);
  const maand = Number(delen.month);
  return maand >= 7 ? jaar : jaar - 1;
}

/** Zet een ruw API-record om naar het model dat wij bewaren. */
export function normaliseerWedstrijd(rauw) {
  const guid = typeof rauw.guid === 'string' ? rauw.guid.trim() : null;
  const datum = normaliseerDatum(rauw.datumString);
  const uur = normaliseerUur(rauw.beginTijd);

  if (!guid || !datum || !uur) return null;

  return {
    guid,
    wedId: rauw.wedID ?? null,
    seizoen: seizoenUitGuid(guid),
    thuisGuid: (rauw.tTGUID ?? '').trim(),
    thuisNaam: (rauw.tTNaam ?? '').trim(),
    uitGuid: (rauw.tUGUID ?? '').trim() || null,
    uitNaam: (rauw.tUNaam ?? '').trim(),
    datum,
    uur,
    locatie: (rauw.accNaam ?? '').trim() || null,
    pouleNaam: (rauw.pouleNaam ?? '').trim() || null,
  };
}

/**
 * Hash over de velden waarvan een wijziging opgevolgd moet worden.
 * Bewust géén score of scheidsrechters: die veranderen constant.
 */
export async function wedstrijdHash(w) {
  const bron = [w.datum, w.uur, w.thuisNaam, w.uitNaam, w.locatie ?? ''].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bron));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** De velden die we vergelijken, met hun label voor het wijzigingslogboek. */
export const GEVOLGDE_VELDEN = [
  ['datum', 'datum'],
  ['uur', 'uur'],
  ['thuisNaam', 'thuisploeg'],
  ['uitNaam', 'bezoekers'],
  ['locatie', 'locatie'],
];

// ---------------------------------------------------------------------------
// Publieke aanroepen
// ---------------------------------------------------------------------------

export async function clubDetail(clubGuid) {
  const json = await haal('OrgDetailByGuid', { issguid: clubGuid });
  return {
    naam: extraheerClubNaam(json),
    teams: extraheerTeams(json, clubGuid),
    rauw: json,
  };
}

export async function clubWedstrijden(clubGuid) {
  const json = await haal('OrgMatchesByGuid', { issguid: clubGuid });
  const lijst = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
  if (!lijst) {
    throw new VblError('Onverwachte structuur bij OrgMatchesByGuid (geen lijst gevonden)');
  }
  return lijst;
}

export async function teamWedstrijden(teamGuid) {
  const json = await haal('TeamMatchesByGuid', { teamguid: teamGuid });
  return Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
}
