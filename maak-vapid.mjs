/**
 * Tests voor het logboek: wat er gelogd wordt, en of het scherm eruit haalt
 * wat het moet halen.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { synchroniseer } from '../src/lib/sync.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

const CLUB = 'BVBL1125';
const TEAM = `${CLUB}G12  1`;
const morgen = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES ('${TEAM}', '${CLUB}', 'G12 A', 'G12');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('ann@club.be',  'Ann',    'Aerts',          0, 'YO',  '${CLUB}');
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_aantal, scope, scope_reden, hash)
    VALUES ('M1','2627','${CLUB}','${TEAM}','G12 A','BC Gast','${morgen()}','14:00','G12',0,1,'auto','h1');
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

const regels = async (env, waar = '1=1') =>
  (await env.DB.prepare(`SELECT * FROM logboek WHERE ${waar} ORDER BY id`).all()).results;

console.log('\n1. Een aanduiding komt in het logboek');
{
  const env = nieuweEnv();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });

  const r = await regels(env, "categorie='aanduiding'");
  check('één regel', r.length, 1);
  check('soort', r[0].soort, 'toegewezen');
  check('wie het deed', r[0].wie, 'baas@club.be');
  check('over wie het gaat', r[0].nieuw, 'Ann Aerts');
  check('aan welke wedstrijd', r[0].match_guid, 'M1');
  check('met de wedstrijd erbij', /G12 A - BC Gast/.test(r[0].veld), true);
}

console.log('\n2. Vrijgeven ook');
{
  const env = nieuweEnv();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });
  await vraag(env, '/api/admin/aanduiding?matchGuid=M1&email=ann@club.be', { methode: 'DELETE' });

  const r = await regels(env, "categorie='aanduiding'");
  check('twee regels', r.map((x) => x.soort), ['toegewezen', 'vrijgegeven']);
  check('vrijgave noteert wie eraf ging', r[1].oud, 'Ann Aerts');
  check('en wie het deed', r[1].wie, 'baas@club.be');
}

console.log('\n3. Een probleemmelding');
{
  const env = nieuweEnv();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });
  await vraag(env, '/api/probleem',
    { methode: 'POST', alsWie: 'ann@club.be', body: { matchGuid: 'M1', bericht: 'Ziek geworden' } });

  const r = await regels(env, "soort='probleem'");
  check('gelogd', r.length, 1);
  check('door de official zelf', r[0].wie, 'ann@club.be');
  check('met het bericht erin', r[0].nieuw, 'Ziek geworden');
}

console.log('\n4. Beheeracties');
{
  const env = nieuweEnv();
  await vraag(env, '/api/admin/season', { methode: 'POST', body: { actie: 'omhoog' } });

  const r = await regels(env, "categorie='beheer'");
  check('seizoenswijziging gelogd', r[0].soort, 'seizoen');
  check('van en naar', [r[0].oud, r[0].nieuw], ['2026-2027', '2027-2028']);
  check('meteen afgehandeld: er valt niets op te volgen', r[0].afgehandeld, 1);
}

console.log('\n5. De synchronisatie logt onder wedstrijd');
{
  const env = nieuweEnv();
  globalThis.fetch = async (url) => {
    if (String(url).includes('OrgMatchesByGuid')) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify([{
          guid: 'BVBL26279170INJ1621FAA', wedID: 'X', tTGUID: TEAM, tTNaam: 'G12 A',
          tUGUID: 'BVBL2000G12  1', tUNaam: 'Nieuw', datumString: '19-09-2026',
          beginTijd: '10.00', accGUID: 'ACC1', accNaam: 'Noord', pouleNaam: 'P', wedOff: [],
        }]),
      };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };

  await synchroniseer(env.DB, 'cron');
  const r = await regels(env, "categorie='wedstrijd'");
  check('nieuwe wedstrijd gelogd', r.some((x) => x.soort === 'nieuw'), true);
  check('door de cron', r[0].wie, 'systeem');
  check('nog niet afgehandeld', r[0].afgehandeld, 0);
}

console.log('\n6. Bulk vrijgeven komt onder beheer');
{
  const env = nieuweEnv();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });
  await vraag(env, '/api/admin/vrijgeven',
    { methode: 'POST', body: { wat: 'beide', uitvoeren: true } });

  const r = await regels(env, "soort='bulk'");
  check('gelogd als beheer', r[0].categorie, 'beheer');
  check('met de periode', /seizoen/.test(r[0].oud), true);
  check('en de aantallen', /1 aanduiding/.test(r[0].nieuw), true);
}

console.log('\n7. Het logboek opvragen');
{
  const env = nieuweEnv();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });
  await vraag(env, '/api/admin/season', { methode: 'POST', body: { actie: 'omhoog' } });

  const alles = await vraag(env, '/api/admin/logboek');
  check('nieuwste eerst', alles.json.regels[0].categorie, 'beheer');
  check('twee regels', alles.json.aantal, 2);
  check('tellers per categorie',
    [alles.json.tellers.aanduiding.aantal, alles.json.tellers.beheer.aantal], [1, 1]);
  check('wedstrijd erbij gezet',
    /G12 A - BC Gast/.test(alles.json.regels[1].wedstrijd), true);

  const enkel = await vraag(env, '/api/admin/logboek?categorie=aanduiding');
  check('filteren op categorie', enkel.json.regels.map((r) => r.categorie), ['aanduiding']);
  check('maar de tellers blijven over alles gaan', enkel.json.tellers.beheer.aantal, 1);

  check('onbekende categorie geweigerd',
    (await vraag(env, '/api/admin/logboek?categorie=onzin')).status, 400);
}

console.log('\n8. Zoeken');
{
  const env = nieuweEnv();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });
  await vraag(env, '/api/admin/season', { methode: 'POST', body: { actie: 'omhoog' } });

  const opNaam = await vraag(env, '/api/admin/logboek?q=Aerts');
  check('op naam van de official', opNaam.json.aantal, 1);

  const opPloeg = await vraag(env, '/api/admin/logboek?q=BC Gast');
  check('op ploegnaam van de tegenstander', opPloeg.json.aantal, 1);

  const niets = await vraag(env, '/api/admin/logboek?q=bestaatniet');
  check('zonder treffers', niets.json.aantal, 0);
}

console.log('\n9. Afhandelen');
{
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO logboek (categorie, soort, match_guid, wie, veld) VALUES
      ('wedstrijd','gewijzigd','M1','systeem','uur'),
      ('wedstrijd','gewijzigd','M1','systeem','locatie'),
      ('wedstrijd','verdwenen','M1','systeem',NULL);
  `);

  const open = await vraag(env, '/api/admin/logboek?open=1');
  check('drie open', open.json.aantal, 3);

  const ids = open.json.regels.slice(0, 2).map((r) => r.id);
  await vraag(env, '/api/admin/logboek', { methode: 'PATCH', body: { ids } });
  check('nog één open', (await vraag(env, '/api/admin/logboek?open=1')).json.aantal, 1);

  await vraag(env, '/api/admin/logboek/alles', { methode: 'POST', body: { categorie: 'wedstrijd' } });
  check('alles afgehandeld', (await vraag(env, '/api/admin/logboek?open=1')).json.aantal, 0);

  check('zonder id geweigerd',
    (await vraag(env, '/api/admin/logboek', { methode: 'PATCH', body: {} })).status, 400);
}

console.log('\n10. Periode');
{
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO logboek (categorie, soort, wie, veld, vastgesteld) VALUES
      ('beheer','club','baas@club.be','recent', datetime('now', '-2 days')),
      ('beheer','club','baas@club.be','oud', datetime('now', '-60 days'));
  `);

  check('standaard dertig dagen', (await vraag(env, '/api/admin/logboek')).json.aantal, 1);
  check('ruimer venster toont meer',
    (await vraag(env, '/api/admin/logboek?dagen=90')).json.aantal, 2);
}

console.log('\n11. Enkel beheerders');
{
  const env = nieuweEnv();
  check('YO mag het logboek niet zien',
    (await vraag(env, '/api/admin/logboek', { alsWie: 'ann@club.be' })).status, 403);
  check('en niets afhandelen',
    (await vraag(env, '/api/admin/logboek',
      { methode: 'PATCH', alsWie: 'ann@club.be', body: { id: 1 } })).status, 403);
}

console.log('\n12. Loggen breekt de actie niet');
{
  const env = nieuweEnv();
  // Logboektabel weg: de aanduiding moet nog steeds lukken.
  env.DB.exec('DROP TABLE logboek');
  const r = await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });
  check('aanduiding lukt toch', r.status, 200);
  check('en staat in de databank',
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM assignments WHERE status='toegewezen'").first()).n, 1);
}

console.log(f === 0 ? '\n=== ALLE LOGBOEKTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
