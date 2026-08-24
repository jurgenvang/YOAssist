/**
 * YOAssist cron-Worker — alles in één bestand.
 *
 * Deze versie is bedoeld om rechtstreeks in de Cloudflare-editor te plakken:
 * vbl.js, sync.js en de Worker zelf staan hieronder achter elkaar. Werk je met
 * wrangler, gebruik dan cron/index.js; dat is dezelfde code, maar in modules.
 *
 * Nodig in het dashboard:
 *   - D1-binding met variabelenaam DB, gekoppeld aan de yoassist-databank
 *   - Cron Trigger: 0 22,23,4,5,10,11,16,17 * * *
 *   - (optioneel) Secret CRON_SECRET om handmatig te kunnen uitlokken
 */

// ===== uit functions/_lib/vbl.js =====
/**
 * Client voor de Basketbal Vlaanderen (Wisseq) API.
 *
 * De API is ongedocumenteerd en de vorm van de responses staat niet vast. Alles
 * hier is daarom defensief: we zoeken naar herkenbare patronen in plaats van
 * vaste velden aan te nemen, en we geven bij twijfel de ruwe structuur terug
 * zodat het beheerscherm kan tonen wat er misging.
 */

const BASIS = 'http://vblcb.wisseq.eu/VBLCB_WebService/data';

class VblError extends Error {}

/** Club-GUID: BVBL gevolgd door exact vier cijfers. */
const CLUB_GUID_PATROON = /^BVBL\d{4}$/;

function normaliseerGuid(guid) {
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
function extraheerTeams(json, clubGuid) {
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
function extraheerClubNaam(json) {
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
function normaliseerDatum(datumString) {
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
function normaliseerUur(beginTijd) {
  if (typeof beginTijd !== 'string') return null;
  const m = beginTijd.trim().match(/^(\d{1,2})[.:h](\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/**
 * Seizoenscode uit een wedstrijd-GUID.
 * 'BVBL26279170INJ1621FAB' -> '2627'
 */
function seizoenUitGuid(guid) {
  if (typeof guid !== 'string') return null;
  const m = guid.match(/^BVBL(\d{4})/);
  return m ? m[1] : null;
}

/** Startjaar 2026 -> seizoenscode '2627'. */
function seizoenscode(startJaar) {
  const a = String(startJaar).slice(-2);
  const b = String(Number(startJaar) + 1).slice(-2);
  return `${a}${b}`;
}

/** Startjaar 2026 -> '2026-2027'. */
function seizoenLabel(startJaar) {
  return `${startJaar}-${Number(startJaar) + 1}`;
}

/**
 * Het seizoen dat op een bepaalde datum loopt. Een seizoen start in juli.
 * Gebruikt de Belgische kalender, niet UTC.
 */
function huidigSeizoenStartJaar(nu = new Date()) {
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
function normaliseerWedstrijd(rauw) {
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
async function wedstrijdHash(w) {
  const bron = [w.datum, w.uur, w.thuisNaam, w.uitNaam, w.locatie ?? ''].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bron));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** De velden die we vergelijken, met hun label voor het wijzigingslogboek. */
const GEVOLGDE_VELDEN = [
  ['datum', 'datum'],
  ['uur', 'uur'],
  ['thuisNaam', 'thuisploeg'],
  ['uitNaam', 'bezoekers'],
  ['locatie', 'locatie'],
];

// ---------------------------------------------------------------------------
// Publieke aanroepen
// ---------------------------------------------------------------------------

async function clubDetail(clubGuid) {
  const json = await haal('OrgDetailByGuid', { issguid: clubGuid });
  return {
    naam: extraheerClubNaam(json),
    teams: extraheerTeams(json, clubGuid),
    rauw: json,
  };
}

async function clubWedstrijden(clubGuid) {
  const json = await haal('OrgMatchesByGuid', { issguid: clubGuid });
  const lijst = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
  if (!lijst) {
    throw new VblError('Onverwachte structuur bij OrgMatchesByGuid (geen lijst gevonden)');
  }
  return lijst;
}

async function teamWedstrijden(teamGuid) {
  const json = await haal('TeamMatchesByGuid', { teamguid: teamGuid });
  return Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
}

// ===== uit functions/_lib/sync.js =====
/**
 * Synchronisatie van wedstrijden vanuit Basketbal Vlaanderen.
 *
 * Wordt door twee kanten aangeroepen: het beheerscherm (handmatig) en de
 * cron-Worker (automatisch). Daarom staat de logica hier en niet in een route.
 *
 * Veiligheden die erin zitten, in volgorde van belangrijkheid:
 *  1. Faalt een club-oproep, dan wordt er voor die club niets gewijzigd.
 *  2. Levert een sync nul wedstrijden op terwijl er er in de databank wel zijn,
 *     dan wordt de sync als mislukt beschouwd en gebeurt er niets.
 *  3. Verdwijnen er meer dan DREMPEL_VERDWENEN wedstrijden, dan worden ze niet
 *     als verdwenen gemarkeerd. Nieuwe en gewijzigde wedstrijden worden wel
 *     verwerkt; de run krijgt status 'deels' zodat het opvalt.
 */

const DREMPEL_VERDWENEN = 3;

async function instelling(db, sleutel, standaard = null) {
  const rij = await db.prepare('SELECT waarde FROM settings WHERE sleutel = ?').bind(sleutel).first();
  return rij ? rij.waarde : standaard;
}

async function zetInstelling(db, sleutel, waarde) {
  await db
    .prepare(
      `INSERT INTO settings (sleutel, waarde, gewijzigd) VALUES (?, ?, datetime('now'))
       ON CONFLICT (sleutel) DO UPDATE SET waarde = excluded.waarde, gewijzigd = datetime('now')`,
    )
    .bind(sleutel, String(waarde))
    .run();
}

/**
 * @param {D1Database} db
 * @param {'cron'|'handmatig'} bron
 */
async function synchroniseer(db, bron) {
  const startJaar = Number(await instelling(db, 'seizoen_start_jaar', '2026'));
  const seizoen = seizoenscode(startJaar);

  const runResultaat = await db
    .prepare(`INSERT INTO sync_runs (bron, status) VALUES (?, 'bezig') RETURNING id`)
    .bind(bron)
    .first();
  const runId = runResultaat.id;

  const rapport = {
    runId,
    seizoen,
    gevonden: 0,
    nieuw: 0,
    gewijzigd: 0,
    verdwenen: 0,
    fouten: [],
    status: 'ok',
    boodschap: null,
  };

  try {
    const clubs = (await db.prepare('SELECT guid, naam FROM clubs WHERE actief = 1').all()).results;
    if (clubs.length === 0) {
      return await sluitAf(db, runId, rapport, 'mislukt', 'Geen actieve clubs geconfigureerd.');
    }

    // Alleen teams waarvoor aanduidingen moeten gebeuren.
    const teams = (
      await db
        .prepare('SELECT guid, club_guid FROM teams WHERE actief = 1 AND (yo = 1 OR yo_plus = 1)')
        .all()
    ).results;
    if (teams.length === 0) {
      return await sluitAf(db, runId, rapport, 'mislukt', 'Geen teams aangevinkt voor aanduidingen.');
    }
    const gevolgdeTeams = new Map(teams.map((t) => [t.guid, t.club_guid]));

    // ---- Ophalen ----------------------------------------------------------
    const gevonden = new Map(); // guid -> genormaliseerde wedstrijd
    const geslaagdeClubs = [];

    for (const club of clubs) {
      let rauweLijst;
      try {
        rauweLijst = await clubWedstrijden(club.guid);
      } catch (err) {
        const boodschap = err instanceof VblError ? err.message : String(err);
        rapport.fouten.push(`${club.naam || club.guid}: ${boodschap}`);
        continue;
      }

      geslaagdeClubs.push(club.guid);

      for (const rauw of rauweLijst) {
        const w = normaliseerWedstrijd(rauw);
        if (!w) continue;
        if (w.seizoen !== seizoen) continue;
        // Youth Officials worden enkel thuis ingezet.
        if (!gevolgdeTeams.has(w.thuisGuid)) continue;

        w.clubGuid = gevolgdeTeams.get(w.thuisGuid);
        w.hash = await wedstrijdHash(w);
        gevonden.set(w.guid, w);
      }
    }

    rapport.gevonden = gevonden.size;

    if (geslaagdeClubs.length === 0) {
      return await sluitAf(
        db,
        runId,
        rapport,
        'mislukt',
        `Geen enkele club kon opgehaald worden. ${rapport.fouten.join(' | ')}`,
      );
    }

    // ---- Vergelijken ------------------------------------------------------
    const placeholders = geslaagdeClubs.map(() => '?').join(',');
    const bestaande = (
      await db
        .prepare(
          `SELECT guid, wed_id, thuis_guid, thuis_naam, uit_guid, uit_naam, datum, uur,
                  locatie, poule_naam, hash, status
             FROM matches
            WHERE seizoen = ? AND club_guid IN (${placeholders})`,
        )
        .bind(seizoen, ...geslaagdeClubs)
        .all()
    ).results;

    const bestaandeMap = new Map(bestaande.map((r) => [r.guid, r]));

    if (gevonden.size === 0 && bestaande.length > 0) {
      return await sluitAf(
        db,
        runId,
        rapport,
        'mislukt',
        'De API gaf nul wedstrijden terug terwijl er er wel bewaard zijn. Er is niets gewijzigd.',
      );
    }

    const opdrachten = [];
    const wijzigingen = [];

    for (const [guid, w] of gevonden) {
      const oud = bestaandeMap.get(guid);

      if (!oud) {
        rapport.nieuw++;
        opdrachten.push(
          db
            .prepare(
              `INSERT INTO matches (guid, wed_id, seizoen, club_guid, thuis_guid, thuis_naam,
                                    uit_guid, uit_naam, datum, uur, locatie, poule_naam, hash,
                                    status, laatst_gezien)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'actief', datetime('now'))`,
            )
            .bind(
              w.guid, w.wedId, w.seizoen, w.clubGuid, w.thuisGuid, w.thuisNaam,
              w.uitGuid, w.uitNaam, w.datum, w.uur, w.locatie, w.pouleNaam, w.hash,
            ),
        );
        wijzigingen.push([guid, 'nieuw', null, null, `${w.datum} ${w.uur} ${w.thuisNaam} - ${w.uitNaam}`]);
        continue;
      }

      const heropgedoken = oud.status === 'verdwenen';

      if (oud.hash === w.hash && !heropgedoken) {
        opdrachten.push(
          db.prepare(`UPDATE matches SET laatst_gezien = datetime('now') WHERE guid = ?`).bind(guid),
        );
        continue;
      }

      rapport.gewijzigd++;
      opdrachten.push(
        db
          .prepare(
            `UPDATE matches
                SET thuis_naam = ?, uit_guid = ?, uit_naam = ?, datum = ?, uur = ?,
                    locatie = ?, poule_naam = ?, hash = ?, status = 'actief',
                    laatst_gezien = datetime('now')
              WHERE guid = ?`,
          )
          .bind(w.thuisNaam, w.uitGuid, w.uitNaam, w.datum, w.uur, w.locatie, w.pouleNaam, w.hash, guid),
      );

      if (heropgedoken) {
        wijzigingen.push([guid, 'gewijzigd', 'status', 'verdwenen', 'actief']);
      }

      const kolomVanVeld = {
        datum: 'datum',
        uur: 'uur',
        thuisNaam: 'thuis_naam',
        uitNaam: 'uit_naam',
        locatie: 'locatie',
      };
      for (const [veld, label] of GEVOLGDE_VELDEN) {
        const oudeWaarde = oud[kolomVanVeld[veld]] ?? '';
        const nieuweWaarde = w[veld] ?? '';
        if (String(oudeWaarde) !== String(nieuweWaarde)) {
          wijzigingen.push([guid, 'gewijzigd', label, String(oudeWaarde), String(nieuweWaarde)]);
        }
      }
    }

    // ---- Verdwenen wedstrijden -------------------------------------------
    const verdwenen = bestaande.filter((r) => r.status === 'actief' && !gevonden.has(r.guid));
    rapport.verdwenen = verdwenen.length;

    let verdwenenVerwerkt = true;
    if (verdwenen.length > DREMPEL_VERDWENEN) {
      verdwenenVerwerkt = false;
      rapport.status = 'deels';
      rapport.boodschap =
        `${verdwenen.length} wedstrijden ontbraken in het antwoord. Dat is meer dan de drempel ` +
        `van ${DREMPEL_VERDWENEN}, dus er is niets als verdwenen gemarkeerd.`;
    } else {
      for (const r of verdwenen) {
        opdrachten.push(
          db.prepare(`UPDATE matches SET status = 'verdwenen' WHERE guid = ?`).bind(r.guid),
        );
        wijzigingen.push([
          r.guid,
          'verdwenen',
          null,
          `${r.datum} ${r.uur} ${r.thuis_naam} - ${r.uit_naam}`,
          null,
        ]);
      }
    }

    for (const [guid, soort, veld, oud, nieuw] of wijzigingen) {
      opdrachten.push(
        db
          .prepare(
            `INSERT INTO match_changes (match_guid, soort, veld, oud, nieuw) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(guid, soort, veld, oud, nieuw),
      );
    }

    if (opdrachten.length > 0) await db.batch(opdrachten);

    if (rapport.fouten.length > 0 && rapport.status === 'ok') {
      rapport.status = 'deels';
      rapport.boodschap = `Niet alle clubs konden opgehaald worden: ${rapport.fouten.join(' | ')}`;
    }
    if (!verdwenenVerwerkt) rapport.verdwenen = 0;

    await zetInstelling(db, 'laatste_sync', new Date().toISOString());

    return await sluitAf(db, runId, rapport, rapport.status, rapport.boodschap);
  } catch (err) {
    return await sluitAf(db, runId, rapport, 'mislukt', `Onverwachte fout: ${err.message}`);
  }
}

async function sluitAf(db, runId, rapport, status, boodschap) {
  rapport.status = status;
  rapport.boodschap = boodschap ?? rapport.boodschap;

  await db
    .prepare(
      `UPDATE sync_runs
          SET geeindigd = datetime('now'), status = ?, aantal_gevonden = ?, aantal_nieuw = ?,
              aantal_gewijzigd = ?, aantal_verdwenen = ?, boodschap = ?
        WHERE id = ?`,
    )
    .bind(
      status,
      rapport.gevonden,
      rapport.nieuw,
      rapport.gewijzigd,
      rapport.verdwenen,
      rapport.boodschap,
      runId,
    )
    .run();

  return rapport;
}

// ===== de Worker zelf =====
/**
 * Cron-Worker voor YOAssist.
 *
 * Cloudflare draait cron in UTC. België wisselt tussen UTC+1 en UTC+2, dus een
 * vaste UTC-lijst zou twee keer per jaar een uur verschuiven. Daarom vuren we
 * op alle kandidaat-uren en beslist de Worker zelf of het in Brussel werkelijk
 * 6, 12, 18 of 0 uur is. Dat is DST-bestendig zonder tzdata-pakket.
 *
 * Met ?force=1 op de fetch-route kun je een run manueel uitlokken tijdens het
 * opzetten; die route is beveiligd met CRON_SECRET.
 */

const DOELUREN = [0, 6, 12, 18];

function brusselsUur(nu = new Date()) {
  const fmt = new Intl.DateTimeFormat('nl-BE', {
    timeZone: 'Europe/Brussels',
    hour: 'numeric',
    hour12: false,
  });
  return Number(fmt.format(nu));
}

export default {
  async scheduled(event, env, ctx) {
    const uur = brusselsUur(new Date(event.scheduledTime));

    if (!DOELUREN.includes(uur)) {
      // Dit tijdstip hoort bij een ander seizoen van de zomertijd. Niets doen.
      return;
    }

    ctx.waitUntil(
      synchroniseer(env.DB, 'cron')
        .then((rapport) => {
          console.log(
            `[YOAssist] sync ${rapport.status}: ${rapport.gevonden} gevonden, ` +
              `${rapport.nieuw} nieuw, ${rapport.gewijzigd} gewijzigd, ${rapport.verdwenen} verdwenen` +
              (rapport.boodschap ? ` — ${rapport.boodschap}` : ''),
          );
        })
        .catch((err) => console.error('[YOAssist] sync mislukt:', err)),
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.searchParams.get('force') !== '1') {
      return new Response('YOAssist cron worker', { status: 200 });
    }

    const geheim = request.headers.get('X-Cron-Secret');
    if (!env.CRON_SECRET || geheim !== env.CRON_SECRET) {
      return new Response('Niet toegestaan', { status: 403 });
    }

    const rapport = await synchroniseer(env.DB, 'handmatig');
    return Response.json(rapport);
  },
};
