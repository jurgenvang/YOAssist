/**
 * Tests voor de handmatige herinnering aan wie nog niet heeft ingevuld.
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

// Eerstvolgende zaterdag, als vaste testankerpunt.
function volgendeZaterdag() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
function zondagNa(zaterdag) {
  const d = new Date(`${zaterdag}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec("UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender'");
  const zat = volgendeZaterdag();
  const zon = zondagNa(zat);
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('ann@club.be',  'Ann',    'Aerts',          0, 'YO',  '${CLUB}'),
      ('bert@club.be', 'Bert',   'Bosmans',        0, 'YO',  '${CLUB}'),
      ('cis@club.be',  'Cis',    'Claes',          0, 'YO',  '${CLUB}');
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_aantal, scope, scope_reden, hash) VALUES
      ('M1','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast Z','${zat}','14:00','G12',0,1,'auto','h1'),
      ('M2','2627','${CLUB}','${CLUB}G12  1','G12 B','Gast Z2','${zon}','11:00','G12',0,1,'auto','h2'),
      ('M3','2627','${CLUB}','${CLUB}G12  1','G12 C','Ver weg','2099-01-01','10:00','G12',0,1,'auto','h3');
  `);
  return { DB: db, ENVIRONMENT: 'development', RESEND_API_KEY: 're_test', zaterdag: zat, zondag: zon };
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'baas@club.be', body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json };
}

const stil = () => { globalThis.fetch = async () => ({ ok: true, json: async () => ({}) }); };

console.log('\n1. Direct versturen, geen droogloop');
{
  const env = nieuweEnv();
  stil();
  const r = await vraag(env, '/api/admin/vul-nog-in', {
    methode: 'POST', body: { zaterdag: env.zaterdag },
  });
  check('meteen uitgevoerd, geen bevestigingsstap', r.status, 200);
  // Vier, niet drie: de beheerder is zelf ook YO+ en heeft evenmin geantwoord.
  // Een beheerder is meestal ook official, dus hoort mee te tellen.
  check('vier officials nog niets ingevuld', r.json.aantal, 4);
  check('alle vier verstuurd', r.json.verstuurd, 4);
}

console.log('\n2. Wie al antwoordde, wordt overgeslagen');
{
  const env = nieuweEnv();
  stil();
  // Ann vult in voor M1 (zaterdag).
  await vraag(env, '/api/availability', {
    methode: 'POST', alsWie: 'ann@club.be', body: { matchGuid: 'M1', status: 'nee' },
  });

  const r = await vraag(env, '/api/admin/vul-nog-in', {
    methode: 'POST', body: { zaterdag: env.zaterdag },
  });
  check('Ann telt niet meer mee', r.json.aantal, 3);
}

console.log('\n3. Enkel wedstrijden van dat weekend tellen mee');
{
  const env = nieuweEnv();
  stil();
  // M3 staat ver in de toekomst en hoort niet mee te tellen voor dit weekend.
  const r = await vraag(env, '/api/admin/vul-nog-in', {
    methode: 'POST', body: { zaterdag: env.zaterdag },
  });
  check('nog steeds vier, M3 telt niet mee voor dit weekend', r.json.aantal, 4);
}

console.log('\n4. Iedereen al beantwoord: geen herinnering nodig');
{
  const env = nieuweEnv();
  stil();
  for (const email of ['ann@club.be', 'bert@club.be', 'cis@club.be', 'baas@club.be']) {
    await vraag(env, '/api/availability', {
      methode: 'POST', alsWie: email, body: { matchGuid: 'M1', status: 'ja' },
    });
  }
  const r = await vraag(env, '/api/admin/vul-nog-in', {
    methode: 'POST', body: { zaterdag: env.zaterdag },
  });
  check('niemand te herinneren', r.json.aantal, 0);
  check('duidelijke boodschap', /Iedereen heeft al geantwoord/.test(r.json.boodschap), true);
}

console.log('\n5. Validatie en rechten');
{
  const env = nieuweEnv();
  check('geen datum', (await vraag(env, '/api/admin/vul-nog-in',
    { methode: 'POST', body: {} })).status, 400);
  check('ongeldige datum', (await vraag(env, '/api/admin/vul-nog-in',
    { methode: 'POST', body: { zaterdag: 'volgende week' } })).status, 400);
  check('geen wedstrijden dat weekend', (await vraag(env, '/api/admin/vul-nog-in',
    { methode: 'POST', body: { zaterdag: '2030-01-05' } })).status, 404);
  check('een YO mag dit niet', (await vraag(env, '/api/admin/vul-nog-in',
    { methode: 'POST', alsWie: 'ann@club.be', body: { zaterdag: env.zaterdag } })).status, 403);
}

console.log('\n6. Komt in het logboek');
{
  const env = nieuweEnv();
  stil();
  await vraag(env, '/api/admin/vul-nog-in', { methode: 'POST', body: { zaterdag: env.zaterdag } });

  const log = (await vraag(env, '/api/admin/logboek')).json.regels;
  const regel = log.find((r) => r.soort === 'herinnering');
  check('staat in het logboek', Boolean(regel), true);
  check('met de beheerder erbij', regel?.wie, 'baas@club.be');
  check('en de ontvangers erin', regel?.nieuw.includes('ann@club.be'), true);
}

console.log(f === 0 ? '\n=== ALLE HERINNERINGSTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
