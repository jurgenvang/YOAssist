/**
 * Tests voor het gebruikersbeheer en het cluboverzicht.
 * Bijzondere aandacht voor de sloten die buitensluiting moeten voorkomen.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';

let mislukt = 0;
const check = (naam, echt, verwacht) => {
  const ok = JSON.stringify(echt) === JSON.stringify(verwacht);
  if (!ok) { mislukt++; console.log(`  FOUT ${naam}: kreeg ${JSON.stringify(echt)}, verwacht ${JSON.stringify(verwacht)}`); }
  else console.log(`  ok   ${naam}`);
};

const CLUB = 'BVBL1125';

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'AB InBev Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code, volgen) VALUES
      ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12', 1),
      ('${CLUB}J16  1', '${CLUB}', 'J16 A', 'J16', 1);
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be',  'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('baas2@club.be', 'Fluppe', 'Van Meerbeeck',  1, 'YO+', '${CLUB}'),
      ('yo@club.be',    'Ann',    'Aerts',          0, 'YO',  '${CLUB}');
  `);
  return { DB: db, ENVIRONMENT: 'development' };
}

async function vraag(env, pad, { methode = 'GET', alsWie = null, body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) {
    opties.body = JSON.stringify(body);
    opties.headers = { 'Content-Type': 'application/json' };
  }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties),
    { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json };
}

const morgen = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

console.log('\n1. Gebruikerslijst');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/admin/users', { alsWie: 'baas@club.be' });

  check('drie gebruikers', r.json.gebruikers.length, 3);
  check('gesorteerd op achternaam, hoofdletterongevoelig',
    r.json.gebruikers.map((g) => g.achternaam), ['Aerts', 'van Geijstelen', 'Van Meerbeeck']);
  check('weergavenaam samengesteld', r.json.gebruikers[0].naam, 'Ann Aerts');
  check('adressenlijst voor Access',
    r.json.accessLijst.split('\n').sort(), ['baas2@club.be', 'baas@club.be', 'yo@club.be']);
  check('YO mag de lijst niet zien',
    (await vraag(env, '/api/admin/users', { alsWie: 'yo@club.be' })).status, 403);
}

console.log('\n2. Gebruiker toevoegen');
{
  const env = nieuweEnv();
  const nieuw = { voornaam: 'Jan', achternaam: 'Peeters', email: '  JAN@Club.BE ', profiel: 'YO' };

  const r = await vraag(env, '/api/admin/users',
    { methode: 'POST', alsWie: 'baas@club.be', body: nieuw });
  check('toegevoegd', r.status, 200);
  check('adres genormaliseerd', r.json.email, 'jan@club.be');
  check('herinnering aan Access', /Access/.test(r.json.herinnering), true);

  check('geen dubbels',
    (await vraag(env, '/api/admin/users',
      { methode: 'POST', alsWie: 'baas@club.be', body: nieuw })).status, 409);
  check('ongeldig adres geweigerd',
    (await vraag(env, '/api/admin/users',
      { methode: 'POST', alsWie: 'baas@club.be', body: { ...nieuw, email: 'geen adres' } })).status, 400);
  check('naam verplicht',
    (await vraag(env, '/api/admin/users',
      { methode: 'POST', alsWie: 'baas@club.be', body: { email: 'x@y.be', voornaam: 'X' } })).status, 400);
  check('onbekende club geweigerd',
    (await vraag(env, '/api/admin/users',
      { methode: 'POST', alsWie: 'baas@club.be',
        body: { ...nieuw, email: 'z@club.be', clubGuid: 'BVBL9999' } })).status, 404);
}

console.log('\n3. Sloten tegen buitensluiting');
{
  const env = nieuweEnv();

  check('kan zichzelf niet degraderen',
    (await vraag(env, '/api/admin/users',
      { methode: 'PATCH', alsWie: 'baas@club.be', body: { email: 'baas@club.be', isAdmin: false } })).status, 409);
  check('kan zichzelf niet deactiveren',
    (await vraag(env, '/api/admin/users',
      { methode: 'PATCH', alsWie: 'baas@club.be', body: { email: 'baas@club.be', actief: false } })).status, 409);
  check('kan zichzelf niet verwijderen',
    (await vraag(env, '/api/admin/users?email=baas@club.be',
      { methode: 'DELETE', alsWie: 'baas@club.be' })).status, 409);

  // Andere beheerder degraderen mag, zolang er één overblijft.
  check('andere beheerder degraderen mag',
    (await vraag(env, '/api/admin/users',
      { methode: 'PATCH', alsWie: 'baas@club.be', body: { email: 'baas2@club.be', isAdmin: false } })).status, 200);

  // Nu is baas@club.be de enige. Die mag niet meer weg via een ander account.
  env.DB.exec("UPDATE users SET is_admin = 1 WHERE email = 'baas2@club.be'");
  env.DB.exec("UPDATE users SET is_admin = 0 WHERE email = 'baas@club.be'");
  check('laatste beheerder blijft beschermd',
    (await vraag(env, '/api/admin/users',
      { methode: 'PATCH', alsWie: 'baas2@club.be', body: { email: 'baas2@club.be', isAdmin: false } })).status, 409);
}

console.log('\n4. Verwijderen versus deactiveren');
{
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam, datum, uur, hash)
      VALUES ('M1', '2627', '${CLUB}', '${CLUB}G12  1', 'G12 A', 'Gast', '${morgen()}', '14:00', 'h');
    INSERT INTO availability (user_email, match_guid, status) VALUES ('yo@club.be', 'M1', 'ja');
  `);

  check('met antwoorden niet verwijderbaar',
    (await vraag(env, '/api/admin/users?email=yo@club.be',
      { methode: 'DELETE', alsWie: 'baas@club.be' })).status, 409);
  check('deactiveren mag wel',
    (await vraag(env, '/api/admin/users',
      { methode: 'PATCH', alsWie: 'baas@club.be', body: { email: 'yo@club.be', actief: false } })).status, 200);
  check('inactief valt uit de Access-lijst',
    (await vraag(env, '/api/admin/users', { alsWie: 'baas@club.be' }))
      .json.accessLijst.includes('yo@club.be'), false);
  check('antwoord blijft bewaard',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM availability').first()).n, 1);
}

console.log('\n5. Cluboverzicht');
{
  const env = nieuweEnv();
  const d = morgen();
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, locatie, acc_guid, cat_code, off_namen, off_aantal, scope, hash)
    VALUES
      ('M1','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast A','${d}','14:00','Sporthal Noord','ACC1','G12','["Yves Knubben","Jan Jansen"]',2,1,'h1'),
      ('M2','2627','${CLUB}','${CLUB}J16  1','J16 A','Gast B','${d}','16:00','Sporthal Noord','ACC1','J16','["Yves Knubben"]',1,1,'h2'),
      ('M3','2627','${CLUB}','${CLUB}G12  1','G12 B','Gast C','${d}','10:00','Sporthal Zuid','ACC2','G12','[]',0,1,'h3');
    INSERT INTO availability (user_email, match_guid, status) VALUES
      ('yo@club.be','M1','ja'), ('baas@club.be','M1','nee'), ('baas2@club.be','M1','ja');
  `);

  const r = await vraag(env, '/api/admin/overzicht?dagen=14', { alsWie: 'baas@club.be' });
  check('drie wedstrijden', r.json.aantal, 3);
  check('chronologisch gesorteerd', r.json.wedstrijden.map((w) => w.uur), ['10:00', '14:00', '16:00']);
  check('telling zonder twee VBL-refs', r.json.zonderVblRefs, 2);
  check('telling zonder beschikbaren', r.json.zonderBeschikbaren, 2);
  check('telling in scope', r.json.inScope, 3);

  const m1 = r.json.wedstrijden.find((w) => w.guid === 'M1');
  check('VBL-namen', m1.vblRefs, ['Yves Knubben', 'Jan Jansen']);
  check('beschikbaren op naam, gesorteerd',
    m1.beschikbaar.map((p) => p.naam), ['Ann Aerts', 'Fluppe Van Meerbeeck']);
  check('niet-beschikbaren apart', m1.nietBeschikbaar.map((p) => p.naam), ['Jurgen van Geijstelen']);
  check('categorie en tarief', [m1.catLabel, m1.tariefCent], ['U12', 1500]);
  check('link naar wedstrijdblad',
    m1.wedstrijdblad, 'https://vblweb.wisseq.eu/Home/MatchDetail?wedguid=M1');

  check('YO mag het overzicht niet zien',
    (await vraag(env, '/api/admin/overzicht', { alsWie: 'yo@club.be' })).status, 403);
}

console.log('\n6. Overzicht respecteert het venster');
{
  const env = nieuweEnv();
  const overDagen = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam, datum, uur, cat_code, hash)
    VALUES
      ('BINNEN','2627','${CLUB}','${CLUB}G12  1','A','B','${overDagen(3)}','14:00','G12','h1'),
      ('BUITEN','2627','${CLUB}','${CLUB}G12  1','A','B','${overDagen(30)}','14:00','G12','h2'),
      ('VERLEDEN','2627','${CLUB}','${CLUB}G12  1','A','B','${overDagen(-3)}','14:00','G12','h3'),
      ('WEG','2627','${CLUB}','${CLUB}G12  1','A','B','${overDagen(3)}','15:00','G12','h4');
    UPDATE matches SET status = 'verdwenen' WHERE guid = 'WEG';
  `);

  const r = await vraag(env, '/api/admin/overzicht?dagen=14', { alsWie: 'baas@club.be' });
  check('enkel binnen het venster', r.json.wedstrijden.map((w) => w.guid), ['BINNEN']);

  const ruim = await vraag(env, '/api/admin/overzicht?dagen=60', { alsWie: 'baas@club.be' });
  check('ruimer venster toont meer', ruim.json.wedstrijden.map((w) => w.guid), ['BINNEN', 'BUITEN']);
}

console.log('\n7. Gewiste namen blijven telbaar');
{
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_namen, off_aantal, off_gewist, hash)
    VALUES ('M1','2627','${CLUB}','${CLUB}G12  1','A','B','${morgen()}','14:00','G12',NULL,2,1,'h');
  `);
  const r = await vraag(env, '/api/admin/overzicht', { alsWie: 'baas@club.be' });
  const m = r.json.wedstrijden[0];
  check('aantal bewaard', m.vblAantal, 2);
  check('namen weg', m.vblRefs, []);
  check('als gewist gemarkeerd', m.vblNamenGewist, true);
}

console.log(mislukt === 0 ? '\n=== ALLE BEHEERTESTS GESLAAGD ===' : `\n=== ${mislukt} TESTS GEFAALD ===`);
process.exit(mislukt ? 1 : 0);
