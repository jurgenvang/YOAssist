/**
 * Tests voor de backup-export.
 *
 * Wat hier vooral vastligt: dat het bestand compleet is en dat het zichzelf
 * uitlegt. Een backup die je over twee jaar niet meer kunt plaatsen, is geen
 * backup.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { VERSIE } from '../src/versie.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

const CLUB = 'BVBL1125';
const TEAM = `${CLUB}G12  1`;

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
                         datum, uur, cat_code, off_aantal, scope, hash)
      VALUES ('M1','2627','${CLUB}','${TEAM}','G12 A','Gast','2099-09-12','14:00','G12',0,1,'h1');
    INSERT INTO availability (user_email, match_guid, status) VALUES ('ann@club.be','M1','ja');
    INSERT INTO assignments (match_guid, user_email, toegewezen_door)
      VALUES ('M1','ann@club.be','baas@club.be');
    INSERT INTO push_abonnementen (user_email, endpoint, p256dh, auth)
      VALUES ('ann@club.be','https://fcm.googleapis.com/x/1','a','b');
  `);
  return { DB: db, ENVIRONMENT: 'development' };
}

async function vraag(env, pad, { alsWie = 'baas@club.be' } = {}) {
  const res = await worker.fetch(new Request(`http://localhost${pad}`),
    { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json, res };
}

console.log('\n1. Omvang vooraf opvragen');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/admin/backup/omvang');

  check('gelukt', r.status, 200);
  check('gebruikers geteld', r.json.tellingen.users, 2);
  check('wedstrijden geteld', r.json.tellingen.matches, 1);
  check('categorieën geteld', r.json.tellingen.categorieen, 12);
  check('totaal klopt met de som',
    r.json.totaalRijen,
    Object.values(r.json.tellingen).reduce((s, n) => s + n, 0));
  check('nog geen backup gemaakt', r.json.laatsteBackup, null);
}

console.log('\n2. Het bestand zelf');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/admin/backup');

  check('als bestand aangeboden',
    /attachment; filename="yoassist-backup-\d{4}-\d{2}-\d{2}\.json"/
      .test(r.res.headers.get('Content-Disposition')), true);

  const bestand = JSON.parse(await r.res.text());

  check('schemaversie erin', bestand.yoassist.versie, VERSIE);
  check('tijdstip erin', /^\d{4}-\d{2}-\d{2}T/.test(bestand.yoassist.gemaaktOp), true);
  check('wie het maakte', bestand.yoassist.gemaaktDoor, 'baas@club.be');
  check('uitleg over terugzetten', /D1-console/.test(bestand.yoassist.opmerking), true);
  check('geen problemen gemeld', bestand.yoassist.problemen, undefined);
}

console.log('\n3. Alles zit erin');
{
  const env = nieuweEnv();
  const bestand = JSON.parse(await (await vraag(env, '/api/admin/backup')).res.text());

  const verwacht = ['settings', 'categorieen', 'clubs', 'users', 'push_abonnementen',
    'teams', 'matches', 'assignments', 'availability', 'problemen', 'logboek', 'sync_runs'];
  check('alle tabellen aanwezig', Object.keys(bestand.gegevens).sort(), [...verwacht].sort());
  check('en in de volgorde voor een herstel', bestand.yoassist.volgorde, verwacht);

  check('gebruikers met hun gegevens', bestand.gegevens.users.length, 2);
  check('inclusief voorkeuren',
    Object.keys(bestand.gegevens.users[0]).includes('kanaal_mail'), true);
  check('wedstrijden erin', bestand.gegevens.matches[0].guid, 'M1');
  check('beschikbaarheden erin', bestand.gegevens.availability.length, 1);
  check('aanduidingen erin', bestand.gegevens.assignments.length, 1);
  check('push-abonnementen erin', bestand.gegevens.push_abonnementen.length, 1);
  check('tellingen kloppen met de inhoud',
    bestand.yoassist.tellingen.users, bestand.gegevens.users.length);
}

console.log('\n4. De volgorde is bruikbaar voor een herstel');
{
  const env = nieuweEnv();
  const bestand = JSON.parse(await (await vraag(env, '/api/admin/backup')).res.text());
  const volgorde = bestand.yoassist.volgorde;

  const voor = (a, b) => volgorde.indexOf(a) < volgorde.indexOf(b);
  check('clubs vóór teams', voor('clubs', 'teams'), true);
  check('clubs vóór gebruikers', voor('clubs', 'users'), true);
  check('teams vóór wedstrijden', voor('teams', 'matches'), true);
  check('wedstrijden vóór aanduidingen', voor('matches', 'assignments'), true);
  check('gebruikers vóór beschikbaarheden', voor('users', 'availability'), true);
}

console.log('\n5. De backup komt in het logboek');
{
  const env = nieuweEnv();
  await vraag(env, '/api/admin/backup');

  const regel = await env.DB.prepare("SELECT * FROM logboek WHERE soort = 'backup'").first();
  check('gelogd', Boolean(regel), true);
  check('met wie het deed', regel.wie, 'baas@club.be');
  check('en de omvang', /rijen over 12 tabellen/.test(regel.nieuw), true);

  const na = await vraag(env, '/api/admin/backup/omvang');
  check('laatste backup wordt nu getoond', Boolean(na.json.laatsteBackup), true);
}

console.log('\n6. Een ontbrekende tabel blokkeert de backup niet');
{
  const env = nieuweEnv();
  env.DB.exec('DROP TABLE push_abonnementen');

  const r = await vraag(env, '/api/admin/backup');
  check('backup lukt toch', r.status, 200);

  const bestand = JSON.parse(await r.res.text());
  check('maar het wordt gemeld',
    bestand.yoassist.problemen.map((x) => x.tabel), ['push_abonnementen']);
  check('en de tabel staat leeg in het bestand', bestand.gegevens.push_abonnementen, []);
  check('de rest is er wel', bestand.gegevens.users.length, 2);
}

console.log('\n7. Een lege databank geeft een geldig bestand');
{
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO users (email, voornaam, achternaam, is_admin, profiel)
           VALUES ('baas@club.be','J','G',1,'YO+')`);
  const env = { DB: db, ENVIRONMENT: 'development' };

  const bestand = JSON.parse(await (await vraag(env, '/api/admin/backup')).res.text());
  check('geldige structuur', Object.keys(bestand).sort(), ['gegevens', 'yoassist']);
  check('lege tabellen zijn lege lijsten', bestand.gegevens.matches, []);
  check('categorieën staan er wel', bestand.gegevens.categorieen.length, 12);
}

console.log('\n8. Enkel beheerders');
{
  const env = nieuweEnv();
  check('YO mag geen backup maken',
    (await vraag(env, '/api/admin/backup', { alsWie: 'ann@club.be' })).status, 403);
  check('en de omvang niet opvragen',
    (await vraag(env, '/api/admin/backup/omvang', { alsWie: 'ann@club.be' })).status, 403);
}

console.log(f === 0 ? '\n=== ALLE BACKUPTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
