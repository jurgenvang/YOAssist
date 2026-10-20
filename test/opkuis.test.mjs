/**
 * Tests voor de dagelijkse opruiming van logboek en sync_runs (V33).
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { kuisLogboekOp, kuisSyncRunsOp } from '../src/lib/opkuis.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

function nieuweDb() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return db;
}

// Ouderdom relatief tegenover nu, zoals de opkuis zelf rekent: een vaste datum
// zou na verloop van tijd in een andere bewaarzone vallen.
function logregel(db, soort, { dagen, afgehandeld = 1, categorie = 'beheer' }) {
  db.exec(`INSERT INTO logboek (categorie, soort, afgehandeld, vastgesteld)
           VALUES ('${categorie}', '${soort}', ${afgehandeld}, datetime('now', '-${dagen} days'))`);
}
function syncronde(db, dagen) {
  db.exec(`INSERT INTO sync_runs (bron, status, gestart)
           VALUES ('cron', 'ok', datetime('now', '-${dagen} days'))`);
}
const soorten = async (db) =>
  (await db.prepare('SELECT soort FROM logboek ORDER BY id').all()).results.map((r) => r.soort);

console.log('\n1. Logboek: afgehandeld en ouder dan een jaar verdwijnt, de rest blijft');
{
  const db = nieuweDb();
  logregel(db, 'oud-af', { dagen: 400 });
  logregel(db, 'oud-open', { dagen: 400, afgehandeld: 0, categorie: 'wedstrijd' });
  logregel(db, 'recent-af', { dagen: 300 });
  logregel(db, 'recent-open', { dagen: 10, afgehandeld: 0, categorie: 'wedstrijd' });

  const weg = await kuisLogboekOp(db);
  check('één regel gewist', weg, 1);
  check('enkel de oude afgehandelde is weg', await soorten(db), ['oud-open', 'recent-af', 'recent-open']);
}

console.log('\n2. Logboek: wat nog openstaat blijft, hoe oud ook');
{
  const db = nieuweDb();
  logregel(db, 'heel-oud-open', { dagen: 2000, afgehandeld: 0, categorie: 'wedstrijd' });
  await kuisLogboekOp(db);
  check('blijft staan', await soorten(db), ['heel-oud-open']);
}

console.log('\n3. Logboek: de laatste backup-regel blijft, oudere backups niet');
{
  // Het beheerscherm haalt 'laatste backup' uit het logboek. Wie een jaar
  // geen backup nam, moet die datum zien en niet 'nooit'.
  const db = nieuweDb();
  logregel(db, 'backup', { dagen: 800 });
  logregel(db, 'backup', { dagen: 500 });
  await kuisLogboekOp(db);
  const rijen = (await db.prepare(
    "SELECT vastgesteld < datetime('now', '-600 days') AS heelOud FROM logboek WHERE soort = 'backup'").all()).results;
  check('één backup-regel over', rijen.length, 1);
  check('en dat is de recentste', rijen[0]?.heelOud, 0);
}

console.log('\n4. sync_runs: ouder dan 60 dagen verdwijnt');
{
  const db = nieuweDb();
  syncronde(db, 90);
  syncronde(db, 61);
  syncronde(db, 59);
  syncronde(db, 1);
  const weg = await kuisSyncRunsOp(db);
  check('twee rondes gewist', weg, 2);
  check('twee over', (await db.prepare('SELECT COUNT(*) AS n FROM sync_runs').first()).n, 2);
}

console.log('\n5. sync_runs: de laatste ronde blijft, ook als ze oud is');
{
  // Het beheerscherm toont de laatste ronde; na een lange stilte moet daar
  // staan wanneer het laatst lukte.
  const db = nieuweDb();
  syncronde(db, 200);
  syncronde(db, 100);
  await kuisSyncRunsOp(db);
  const rijen = (await db.prepare(
    "SELECT gestart > datetime('now', '-150 days') AS recentste FROM sync_runs").all()).results;
  check('één ronde over', rijen.length, 1);
  check('en dat is de laatste', rijen[0]?.recentste, 1);
}

console.log('\n6. Een fout in de databank breekt de uurtaak niet');
{
  const kapot = { prepare: () => ({ bind: () => ({ run: () => Promise.reject(new Error('D1 weg')) }) }) };
  check('logboek: 0 in plaats van een fout', await kuisLogboekOp(kapot), 0);
  check('sync_runs: 0 in plaats van een fout', await kuisSyncRunsOp(kapot), 0);
}

console.log('\n7. De uurtaak om 4 uur ruimt beide op');
{
  const db = nieuweDb();
  logregel(db, 'oud-af', { dagen: 400 });
  syncronde(db, 90);
  syncronde(db, 1);

  const wachten = [];
  const ctx = { waitUntil: (p) => { wachten.push(p); return p; } };
  // 4 uur Brussel = 2 uur UTC in de zomer.
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-10T02:00:00Z') }, { DB: db }, ctx);
  await Promise.allSettled(wachten);

  check('logregel weg', (await db.prepare('SELECT COUNT(*) AS n FROM logboek WHERE soort = ?').bind('oud-af').first()).n, 0);
  check('oude syncronde weg', (await db.prepare('SELECT COUNT(*) AS n FROM sync_runs').first()).n, 1);
}

console.log(f === 0 ? '\n=== ALLE OPKUISTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
