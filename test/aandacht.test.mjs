/**
 * Tests voor de admin-routes van de aandachtspagina (V31).
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

const CLUB = 'BVBL1125';

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('ann@club.be',  'Ann',    'Aerts',          0, 'YO',  '${CLUB}');
  `);
  return { DB: db, ENVIRONMENT: 'development' };
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'baas@club.be', body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json };
}

const zetVblFetch = (naam) => {
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ pTeams: [{ pTNaam: naam }] }),
  });
};

console.log('\n1. Een club toevoegen en weer weghalen');
{
  const env = nieuweEnv();
  zetVblFetch('Verre Club');

  const toe = await vraag(env, '/api/admin/volg-clubs',
    { methode: 'POST', body: { guid: 'bvbl9999' } });
  check('toegevoegd', toe.status, 200);
  check('GUID hoofdletters', toe.json.guid, 'BVBL9999');

  const lijst = await vraag(env, '/api/admin/volg-clubs');
  check('staat in de lijst', lijst.json.clubs.length, 1);

  const dubbel = await vraag(env, '/api/admin/volg-clubs',
    { methode: 'POST', body: { guid: 'BVBL9999' } });
  check('niet twee keer', dubbel.status, 409);

  const weg = await vraag(env, '/api/admin/volg-clubs?guid=BVBL9999', { methode: 'DELETE' });
  check('verwijderd', weg.json.verwijderd, 1);
  check('lijst weer leeg',
    (await vraag(env, '/api/admin/volg-clubs')).json.clubs.length, 0);
}

console.log('\n2. Alleen een beheerder mag clubs beheren');
{
  const env = nieuweEnv();
  check('YO mag niet toevoegen', (await vraag(env, '/api/admin/volg-clubs',
    { methode: 'POST', alsWie: 'ann@club.be', body: { guid: 'BVBL1' } })).status, 403);
  check('YO mag niet verwijderen', (await vraag(env, '/api/admin/volg-clubs?guid=BVBL1',
    { methode: 'DELETE', alsWie: 'ann@club.be' })).status, 403);
  check('YO mag de lijst niet zien', (await vraag(env, '/api/admin/volg-clubs',
    { alsWie: 'ann@club.be' })).status, 403);
}

console.log('\n3. De aandachtslijst filtert op nul of één ref, binnen twee weken');
{
  const env = nieuweEnv();
  const morgen = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const overDrieWeken = () => new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10);

  env.DB.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");
  env.DB.exec(`
    INSERT INTO volg_wedstrijden (guid, club_guid, club_naam, thuis_naam, uit_naam, datum, uur, vbl_aantal) VALUES
      ('W1', 'BVBL9999', 'Verre Club', 'A', 'B', '${morgen()}', '14:00', 0),
      ('W2', 'BVBL9999', 'Verre Club', 'C', 'D', '${morgen()}', '16:00', 1),
      ('W3', 'BVBL9999', 'Verre Club', 'E', 'F', '${morgen()}', '18:00', 2),
      ('W4', 'BVBL9999', 'Verre Club', 'G', 'H', '${overDrieWeken()}', '10:00', 0);
  `);

  const r = await vraag(env, '/api/admin/aandacht');
  check('twee wedstrijden voldoen', r.json.aantal, 2);
  check('W1 en W2 erin, niet W3 (twee refs) of W4 (te ver)',
    r.json.wedstrijden.map((w) => w.guid).sort(), ['W1', 'W2']);
}

console.log('\n4. Handmatig synchroniseren via de knop');
{
  const env = nieuweEnv();
  env.DB.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");
  globalThis.fetch = async (url) => {
    if (String(url).includes('OrgMatchesByGuid')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{
        guid: 'BVBLW1', wedID: 'W1', tTGUID: 'T1', tTNaam: 'Thuis', tUGUID: 'T2', tUNaam: 'Uit',
        datumString: '20-09-2026', beginTijd: '14.00', wedOff: [], gespeeld: 'N', uitslag: '',
      }]) };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };

  const r = await vraag(env, '/api/admin/aandacht/sync', { methode: 'POST' });
  check('sync gelukt', r.status, 200);
  check('één club, één wedstrijd', [r.json.clubs, r.json.gevonden], [1, 1]);

  const log = (await vraag(env, '/api/admin/logboek')).json.regels;
  check('staat in het logboek', log.some((l) => l.veld === 'aandachtspagina gesynchroniseerd'), true);
}

console.log(f === 0 ? '\n=== ALLE AANDACHTSTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
