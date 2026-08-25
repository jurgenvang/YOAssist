/**
 * Tests voor de CSV-lezer en de bulkimport van gebruikers.
 * De lezer eerst los: daar zitten de eigenaardigheden van Excel-exports in.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { leesCsv, maakCsv, detecteerScheidingsteken, alsBoolean } from '../src/lib/csv.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

console.log('\n1. Scheidingsteken herkennen');
check('komma', detecteerScheidingsteken('a,b,c\n1,2,3'), ',');
check('puntkomma zoals Excel op een Belgische machine', detecteerScheidingsteken('a;b;c\n1;2;3'), ';');
check('bij twijfel komma', detecteerScheidingsteken('a,b;c'), ',');

console.log('\n2. Lezen');
{
  const r = leesCsv('email,voornaam\njan@x.be,Jan\nann@x.be,Ann');
  check('kolommen in kleine letters', r.kolommen, ['email', 'voornaam']);
  check('twee rijen', r.rijen.length, 2);
  check('waarden', r.rijen[0].email, 'jan@x.be');
  check('regelnummer klopt met het bestand', [r.rijen[0]._regel, r.rijen[1]._regel], [2, 3]);
}

{
  const r = leesCsv('EMAIL;Voornaam\r\njan@x.be;Jan\r\n');
  check('puntkomma en Windows-regeleindes', r.rijen[0].voornaam, 'Jan');
  check('lege slotregel genegeerd', r.rijen.length, 1);
}

{
  const r = leesCsv('\uFEFFemail,naam\njan@x.be,Jan');
  check('BOM verwijderd', r.kolommen[0], 'email');
}

{
  const r = leesCsv('naam,opmerking\n"Peeters, Jan","zegt ""hallo"""');
  check('komma binnen aanhalingstekens', r.rijen[0].naam, 'Peeters, Jan');
  check('dubbele quote wordt één quote', r.rijen[0].opmerking, 'zegt "hallo"');
}

{
  const r = leesCsv('a,b,c\n1,2');
  check('ontbrekend veld wordt leeg', r.rijen[0].c, '');
  check('lege invoer', leesCsv('').rijen, []);
  check('enkel een kop', leesCsv('a,b').rijen, []);
}

console.log('\n3. Schrijven');
{
  const csv = maakCsv(['a', 'b'], [{ a: 'x', b: 'y' }]);
  check('eenvoudig', csv, 'a,b\nx,y');
  check('veld met komma wordt omsloten',
    maakCsv(['a'], [{ a: 'x,y' }]), 'a\n"x,y"');
  check('quote wordt verdubbeld',
    maakCsv(['a'], [{ a: 'zegt "hoi"' }]), 'a\n"zegt ""hoi"""');
  check('heen en weer blijft gelijk',
    leesCsv(maakCsv(['naam'], [{ naam: 'Peeters, Jan' }])).rijen[0].naam, 'Peeters, Jan');
}

console.log('\n4. Booleaanse velden');
check('1', alsBoolean('1'), true);
check('ja', alsBoolean('Ja'), true);
check('true', alsBoolean('TRUE'), true);
check('x', alsBoolean('x'), true);
check('0', alsBoolean('0'), false);
check('leeg', alsBoolean(''), false);
check('nee', alsBoolean('nee'), false);

// ---------------------------------------------------------------------------
const CLUB = 'BVBL1125';

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('bestaat@club.be', 'Al', 'Aanwezig', 0, 'YO', '${CLUB}');
  `);
  return { DB: db, ENVIRONMENT: 'development' };
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'baas@club.be', body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json, res };
}

const importeer = (env, csv, uitvoeren = false) =>
  vraag(env, '/api/admin/users/import', { methode: 'POST', body: { csv, uitvoeren } });

console.log('\n5. Het sjabloon');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/admin/users/template');
  check('als bestand aangeboden',
    r.res.headers.get('Content-Disposition').includes('yoassist-gebruikers.csv'), true);

  const tekst = await r.res.text();
  const gelezen = leesCsv(tekst);
  check('bevat de verwachte kolommen', gelezen.kolommen,
    ['email', 'voornaam', 'achternaam', 'profiel', 'club_guid', 'is_admin']);

  // Het sjabloon moet zonder wijziging inleesbaar zijn en niets toevoegen.
  const terug = await importeer(env, tekst);
  check('voorbeeldregel wordt genegeerd', terug.json.aantalNieuw, 0);
  check('en telt niet als fout', terug.json.aantalFouten, 0);
}

console.log('\n6. Droogloop verandert niets');
{
  const env = nieuweEnv();
  const csv = 'email,voornaam,achternaam,profiel\nann@club.be,Ann,Aerts,YO\nbert@club.be,Bert,Bosmans,YO+';

  const r = await importeer(env, csv);
  check('twee nieuw', r.json.aantalNieuw, 2);
  check('niet uitgevoerd', r.json.uitgevoerd, false);
  check('databank ongemoeid',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n, 2);
  check('herinnering aan Access', /Access/.test(r.json.herinnering), true);
}

console.log('\n7. Uitvoeren schrijft weg');
{
  const env = nieuweEnv();
  const csv = 'email,voornaam,achternaam,profiel,is_admin\nann@club.be,Ann,Aerts,YO,0\nchef@club.be,Chef,Baas,YO+,ja';

  await importeer(env, csv, true);
  const rijen = (await env.DB.prepare(
    "SELECT email, profiel, is_admin FROM users WHERE email LIKE '%@club.be' ORDER BY email").all()).results;
  check('vier gebruikers in totaal', rijen.length, 4);
  check('profiel overgenomen', rijen.find((r) => r.email === 'bert@club.be'), undefined);
  check('YO+ correct', rijen.find((r) => r.email === 'chef@club.be').profiel, 'YO+');
  check('is_admin uit "ja"', rijen.find((r) => r.email === 'chef@club.be').is_admin, 1);
  check('gewone YO niet admin', rijen.find((r) => r.email === 'ann@club.be').is_admin, 0);
}

console.log('\n8. Fouten per regel, zonder de rest te blokkeren');
{
  const env = nieuweEnv();
  const csv = [
    'email,voornaam,achternaam,profiel',
    'goed@club.be,Goed,Gaat,YO',
    'geen adres,Fout,Adres,YO',
    'zonder@club.be,,Achternaam,YO',
    'bestaat@club.be,Al,Aanwezig,YO',
    'dubbel@club.be,Een,Keer,YO',
    'dubbel@club.be,Twee,Keer,YO',
  ].join('\n');

  const r = await importeer(env, csv, true);
  // Twee goede regels (goed@ en de eerste dubbel@), drie foute (ongeldig adres,
  // ontbrekende voornaam, en de tweede dubbel@).
  check('goede regels toegevoegd', r.json.aantalNieuw, 2);
  check('bestaande overgeslagen', r.json.overgeslagen.map((o) => o.email), ['bestaat@club.be']);
  check('drie fouten', r.json.aantalFouten, 3);
  check('ongeldig adres met regelnummer',
    r.json.fouten.find((x) => /ongeldig/.test(x.reden)).regel, 3);
  check('ontbrekende naam gemeld',
    r.json.fouten.some((x) => /voornaam of achternaam/.test(x.reden)), true);
  check('dubbel in het bestand gemeld',
    r.json.fouten.some((x) => /twee keer/.test(x.reden)), true);
  check('de goede staat er echt in',
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email='goed@club.be'").first()).n, 1);
}

console.log('\n9. Club en profiel');
{
  const env = nieuweEnv();
  const goed = 'email,voornaam,achternaam,profiel,club_guid\na@club.be,A,A,YO,' + CLUB;
  const r1 = await importeer(env, goed, true);
  check('bestaande club aanvaard', r1.json.aantalNieuw, 1);
  check('club gekoppeld',
    (await env.DB.prepare("SELECT club_guid FROM users WHERE email='a@club.be'").first()).club_guid, CLUB);

  const fout = 'email,voornaam,achternaam,profiel,club_guid\nb@club.be,B,B,YO,BVBL9999';
  const r2 = await importeer(env, fout);
  check('onbekende club geweigerd', r2.json.aantalFouten, 1);
  check('met een duidelijke reden', /bestaat niet/.test(r2.json.fouten[0].reden), true);

  const raar = 'email,voornaam,achternaam,profiel\nc@club.be,C,C,SUPERYO';
  const r3 = await importeer(env, raar);
  check('onbekend profiel valt terug op YO', r3.json.nieuw[0].profiel, 'YO');
}

console.log('\n10. Slechte invoer');
{
  const env = nieuweEnv();
  check('leeg bestand', (await importeer(env, '')).status, 400);
  check('enkel een kop', (await importeer(env, 'email,voornaam,achternaam')).status, 400);

  const ontbreekt = await importeer(env, 'email,naam\na@b.be,Jan');
  check('ontbrekende kolommen gemeld', ontbreekt.status, 400);
  check('met vermelding van welke', /achternaam/.test(ontbreekt.json.detail), true);
}

console.log('\n11. Enkel beheerders');
{
  const env = nieuweEnv();
  env.DB.exec(`INSERT INTO users (email, voornaam, achternaam, profiel) VALUES ('yo@club.be','Y','O','YO')`);
  check('YO mag het sjabloon niet',
    (await vraag(env, '/api/admin/users/template', { alsWie: 'yo@club.be' })).status, 403);
  check('YO mag niet importeren',
    (await vraag(env, '/api/admin/users/import',
      { methode: 'POST', alsWie: 'yo@club.be', body: { csv: 'email,voornaam,achternaam\na@b.be,A,B' } })).status, 403);
}

console.log(f === 0 ? '\n=== ALLE CSV-TESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
