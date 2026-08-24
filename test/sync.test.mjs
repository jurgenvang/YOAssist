/**
 * Test van de synchronisatielogica tegen een echte SQLite-databank.
 * De API wordt nagebootst door globalThis.fetch te vervangen, zodat het
 * volledige pad door vbl.js mee getest wordt: BOM, JSON, normalisatie, hash.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import { synchroniseer, DREMPEL_VERDWENEN } from '../functions/_lib/sync.js';

let mislukt = 0;
const check = (naam, echt, verwacht) => {
  const ok = JSON.stringify(echt) === JSON.stringify(verwacht);
  if (!ok) {
    mislukt++;
    console.log(`  FOUT ${naam}: kreeg ${JSON.stringify(echt)}, verwacht ${JSON.stringify(verwacht)}`);
  } else {
    console.log(`  ok   ${naam}`);
  }
};

const CLUB = 'BVBL1053';
const TEAM_A = 'BVBL1053J16  1';
const TEAM_B = 'BVBL1053HSE  1';

function wed(nr, opties = {}) {
  return {
    guid: `BVBL26279170INJ1621F${nr}`,
    wedID: `INJ1621F${nr}`,
    tTGUID: opties.thuis ?? TEAM_A,
    tTNaam: opties.thuisNaam ?? 'BC Alpha U16',
    tUGUID: 'BVBL2000J16  1',
    tUNaam: opties.uit ?? 'BC Gamma U16',
    datumString: opties.datum ?? '12-09-2026',
    beginTijd: opties.uur ?? '20.30',
    accNaam: opties.locatie ?? 'Sporthal Noord',
    pouleNaam: 'IJ16 F',
    gespeeld: 'N',
    uitslag: '',
    wedOff: null,
  };
}

/** Vervangt fetch. Geeft een BOM mee, net als de echte API soms doet. */
function zetApi(wedstrijden, { faal = false } = {}) {
  globalThis.fetch = async (url) => {
    if (faal) return { ok: false, status: 503, text: async () => '' };
    if (String(url).includes('OrgMatchesByGuid')) {
      return { ok: true, status: 200, text: async () => '\uFEFF' + JSON.stringify(wedstrijden) };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };
}

function nieuweDb() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'BC Alpha')`);
  db.exec(`INSERT INTO teams (guid, club_guid, naam, yo, yo_plus) VALUES
    ('${TEAM_A}', '${CLUB}', 'U16 A', 1, 1),
    ('${TEAM_B}', '${CLUB}', 'Heren Senioren', 0, 1)`);
  return db;
}

const tel = async (db, sql, ...p) => (await db.prepare(sql).bind(...p).first())?.n ?? 0;

// ---------------------------------------------------------------------------
console.log('\n1. Eerste synchronisatie voegt wedstrijden toe');
{
  const db = nieuweDb();
  zetApi([wed('AA'), wed('AB'), wed('AC', { thuis: TEAM_B, thuisNaam: 'BC Alpha Heren' })]);
  const r = await synchroniseer(db, 'handmatig');

  check('status', r.status, 'ok');
  check('gevonden', r.gevonden, 3);
  check('nieuw', r.nieuw, 3);
  check('in databank', await tel(db, 'SELECT COUNT(*) AS n FROM matches'), 3);
  check('logboek nieuw', await tel(db, "SELECT COUNT(*) AS n FROM match_changes WHERE soort='nieuw'"), 3);
}

console.log('\n2. Uitwedstrijden en ander seizoen worden genegeerd');
{
  const db = nieuweDb();
  zetApi([
    wed('AA'),
    { ...wed('AB'), tTGUID: 'BVBL9999J16  1', tTNaam: 'BC Vreemd' },   // uitwedstrijd
    { ...wed('AC'), guid: 'BVBL25269170INJ1621FAC' },                  // vorig seizoen
  ]);
  const r = await synchroniseer(db, 'handmatig');

  check('enkel thuis, enkel dit seizoen', r.gevonden, 1);
  check('in databank', await tel(db, 'SELECT COUNT(*) AS n FROM matches'), 1);
}

console.log('\n3. Teams zonder vinkje leveren geen wedstrijden op');
{
  const db = nieuweDb();
  db.exec(`UPDATE teams SET yo = 0, yo_plus = 0`);
  zetApi([wed('AA')]);
  const r = await synchroniseer(db, 'handmatig');
  check('mislukt zonder aangevinkte teams', r.status, 'mislukt');
  check('niets bewaard', await tel(db, 'SELECT COUNT(*) AS n FROM matches'), 0);
}

console.log('\n4. Wijziging van uur en locatie wordt gedetecteerd en gelogd');
{
  const db = nieuweDb();
  zetApi([wed('AA'), wed('AB')]);
  await synchroniseer(db, 'handmatig');

  zetApi([wed('AA', { uur: '21.00', locatie: 'Sporthal Zuid' }), wed('AB')]);
  const r = await synchroniseer(db, 'handmatig');

  check('status', r.status, 'ok');
  check('aantal gewijzigd', r.gewijzigd, 1);
  check('niets nieuw', r.nieuw, 0);

  const rij = await db.prepare('SELECT uur, locatie FROM matches WHERE guid = ?')
    .bind('BVBL26279170INJ1621FAA').first();
  check('uur bijgewerkt', rij.uur, '21:00');
  check('locatie bijgewerkt', rij.locatie, 'Sporthal Zuid');

  const velden = (await db.prepare(
    "SELECT veld, oud, nieuw FROM match_changes WHERE soort='gewijzigd' ORDER BY veld").all()).results;
  check('twee velden gelogd', velden.map(v => v.veld), ['locatie', 'uur']);
  check('oude waarde bewaard', velden[1].oud, '20:30');
  check('nieuwe waarde bewaard', velden[1].nieuw, '21:00');
}

console.log('\n5. Ongewijzigde wedstrijden geven geen ruis in het logboek');
{
  const db = nieuweDb();
  zetApi([wed('AA'), wed('AB')]);
  await synchroniseer(db, 'handmatig');
  const r = await synchroniseer(db, 'handmatig');

  check('niets nieuw', r.nieuw, 0);
  check('niets gewijzigd', r.gewijzigd, 0);
  check('logboek blijft op 2 (enkel de eerste run)',
    await tel(db, 'SELECT COUNT(*) AS n FROM match_changes'), 2);
}

console.log('\n6. Tot en met de drempel worden verdwenen wedstrijden gemarkeerd');
{
  const db = nieuweDb();
  const alle = ['AA', 'AB', 'AC', 'AD', 'AE'].map((n) => wed(n));
  zetApi(alle);
  await synchroniseer(db, 'handmatig');

  zetApi(alle.slice(0, 5 - DREMPEL_VERDWENEN));   // er verdwijnen er precies 3
  const r = await synchroniseer(db, 'handmatig');

  check('status ok', r.status, 'ok');
  check('drie verdwenen', r.verdwenen, DREMPEL_VERDWENEN);
  check('gemarkeerd, niet gewist',
    await tel(db, "SELECT COUNT(*) AS n FROM matches WHERE status='verdwenen'"), 3);
  check('rijen blijven bestaan', await tel(db, 'SELECT COUNT(*) AS n FROM matches'), 5);
  check('gelogd', await tel(db, "SELECT COUNT(*) AS n FROM match_changes WHERE soort='verdwenen'"), 3);
}

console.log('\n7. Boven de drempel gebeurt er niets met de verdwenen wedstrijden');
{
  const db = nieuweDb();
  const alle = ['AA', 'AB', 'AC', 'AD', 'AE'].map((n) => wed(n));
  zetApi(alle);
  await synchroniseer(db, 'handmatig');

  zetApi([alle[0], wed('AZ')]);                   // 4 weg, 1 nieuw
  const r = await synchroniseer(db, 'handmatig');

  check('status deels', r.status, 'deels');
  check('geen enkele als verdwenen geteld', r.verdwenen, 0);
  check('alles blijft actief',
    await tel(db, "SELECT COUNT(*) AS n FROM matches WHERE status='verdwenen'"), 0);
  check('nieuwe wedstrijd wél verwerkt', r.nieuw, 1);
  check('boodschap vermeldt de drempel', /drempel/.test(r.boodschap), true);
}

console.log('\n8. Een leeg antwoord wist niets');
{
  const db = nieuweDb();
  zetApi([wed('AA'), wed('AB')]);
  await synchroniseer(db, 'handmatig');

  zetApi([]);
  const r = await synchroniseer(db, 'handmatig');

  check('status mislukt', r.status, 'mislukt');
  check('alles blijft actief',
    await tel(db, "SELECT COUNT(*) AS n FROM matches WHERE status='actief'"), 2);
}

console.log('\n9. Een onbereikbare API wist niets');
{
  const db = nieuweDb();
  zetApi([wed('AA'), wed('AB')]);
  await synchroniseer(db, 'handmatig');

  zetApi([], { faal: true });
  const r = await synchroniseer(db, 'handmatig');

  check('status mislukt', r.status, 'mislukt');
  check('alles blijft staan', await tel(db, "SELECT COUNT(*) AS n FROM matches WHERE status='actief'"), 2);
  check('run gelogd', await tel(db, "SELECT COUNT(*) AS n FROM sync_runs WHERE status='mislukt'"), 1);
}

console.log('\n10. Een teruggekeerde wedstrijd wordt weer actief');
{
  const db = nieuweDb();
  zetApi([wed('AA'), wed('AB')]);
  await synchroniseer(db, 'handmatig');

  zetApi([wed('AA')]);
  await synchroniseer(db, 'handmatig');
  check('AB verdwenen',
    (await db.prepare('SELECT status FROM matches WHERE guid = ?')
      .bind('BVBL26279170INJ1621FAB').first()).status, 'verdwenen');

  zetApi([wed('AA'), wed('AB')]);
  await synchroniseer(db, 'handmatig');
  check('AB terug actief',
    (await db.prepare('SELECT status FROM matches WHERE guid = ?')
      .bind('BVBL26279170INJ1621FAB').first()).status, 'actief');
}

console.log('\n11. Beschikbaarheden overleven een verdwenen wedstrijd');
{
  const db = nieuweDb();
  db.exec(`INSERT INTO users (email, naam, profiel, club_guid) VALUES ('yo@club.be','Jan','YO','${CLUB}')`);
  zetApi([wed('AA')]);
  await synchroniseer(db, 'handmatig');
  db.exec(`INSERT INTO availability (user_email, match_guid, status)
           VALUES ('yo@club.be','BVBL26279170INJ1621FAA','ja')`);

  zetApi([]);                                     // mislukte run
  await synchroniseer(db, 'handmatig');
  check('beschikbaarheid bewaard', await tel(db, 'SELECT COUNT(*) AS n FROM availability'), 1);
}

console.log('\n12. Seizoenswissel: wedstrijden van het nieuwe seizoen komen erbij');
{
  const db = nieuweDb();
  zetApi([wed('AA')]);
  await synchroniseer(db, 'handmatig');

  db.exec(`UPDATE settings SET waarde = '2027' WHERE sleutel = 'seizoen_start_jaar'`);
  zetApi([{ ...wed('BA'), guid: 'BVBL27289170INJ1621FBA' }]);
  const r = await synchroniseer(db, 'handmatig');

  check('nieuw seizoen gevonden', r.gevonden, 1);
  check('nieuw toegevoegd', r.nieuw, 1);
  check('oud seizoen niet aangeraakt',
    await tel(db, "SELECT COUNT(*) AS n FROM matches WHERE seizoen='2627' AND status='actief'"), 1);
  check('beide seizoenen bewaard', await tel(db, 'SELECT COUNT(*) AS n FROM matches'), 2);
}

console.log(mislukt === 0 ? '\n=== ALLE SYNCTESTS GESLAAGD ===' : `\n=== ${mislukt} TESTS GEFAALD ===`);
process.exit(mislukt ? 1 : 0);
