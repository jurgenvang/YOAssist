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

  const r = await vraag(env, '/api/admin/overzicht', { alsWie: 'baas@club.be' });
  check('drie wedstrijden', r.json.aantal, 3);
  check('venster meegestuurd', r.json.venster.weekends.length, 2);
  check('venster heeft een leesbaar label', typeof r.json.venster.label, 'string');
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
  check('enkel binnen het dagvenster', r.json.wedstrijden.map((w) => w.guid), ['BINNEN']);

  const ruim = await vraag(env, '/api/admin/overzicht?dagen=60', { alsWie: 'baas@club.be' });
  check('ruimer dagvenster toont meer', ruim.json.wedstrijden.map((w) => w.guid), ['BINNEN', 'BUITEN']);
  check('maar de verre wedstrijd valt buiten het weekendvenster',
    ruim.json.wedstrijden.find((w) => w.guid === 'BUITEN').inVenster, false);
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

console.log('\n8. Tellers gaan over het weekendvenster, niet over de hele lijst');
{
  const env = nieuweEnv();
  const overDagen = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_aantal, scope, scope_reden, hash) VALUES
      ('DICHTBIJ','2627','${CLUB}','${CLUB}G12  1','A','B','${overDagen(2)}','14:00','G12',0,1,'auto','h1'),
      ('VERWEG','2627','${CLUB}','${CLUB}G12  1','A','B','${overDagen(50)}','14:00','G12',0,1,'auto','h2');
  `);

  const r = await vraag(env, '/api/admin/overzicht', { alsWie: 'baas@club.be' });
  check('beide in de lijst', r.json.aantal, 2);
  check('maar slechts één in het venster', r.json.inVenster, 1);
  check('teller in scope telt enkel het venster', r.json.inScope, 1);
  check('teller onvolledig ook', r.json.onvolledig, 1);

  const dichtbij = r.json.wedstrijden.find((w) => w.guid === 'DICHTBIJ');
  check('probleemvlag gezet: niemand beschikbaar', dichtbij.probleem, true);
  check('en het wordt geteld', r.json.metProbleem, 1);
}

console.log('\n9. Geen probleem zodra er genoeg toegewezen zijn');
{
  const env = nieuweEnv();
  const morgenIso = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_aantal, scope, scope_reden, hash)
      VALUES ('VOL','2627','${CLUB}','${CLUB}G12  1','A','B','${morgenIso}','14:00','G12',0,1,'auto','h');
    INSERT INTO availability (user_email, match_guid, status) VALUES
      ('yo@club.be','VOL','ja'), ('baas2@club.be','VOL','ja');
    INSERT INTO assignments (match_guid, user_email, toegewezen_door) VALUES
      ('VOL','yo@club.be','baas@club.be'), ('VOL','baas2@club.be','baas@club.be');
  `);

  const r = await vraag(env, '/api/admin/overzicht', { alsWie: 'baas@club.be' });
  const vol = r.json.wedstrijden.find((w) => w.guid === 'VOL');
  check('volledig aangeduid en iemand beschikbaar: geen probleem', vol.probleem, false);
  check('teller op nul', r.json.metProbleem, 0);
}

console.log('\n10. Buiten scope is nooit een probleem');
{
  const env = nieuweEnv();
  const d = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_aantal, scope, hash)
      VALUES ('BUITENSCOPE','2627','${CLUB}','${CLUB}J16  1','A','B','${d}','14:00','J16',0,0,'h');
  `);
  const r = await vraag(env, '/api/admin/overzicht', { alsWie: 'baas@club.be' });
  check('geen probleem buiten de beschikbaarhedenlijst',
    r.json.wedstrijden.find((w) => w.guid === 'BUITENSCOPE').probleem, false);
  check('teller blijft nul', r.json.metProbleem, 0);
}

console.log('\n11. Onbekende categorie start uitgeschakeld');
{
  const env = nieuweEnv();
  // Nabootsing van de API: één bekende ploeg (G12) en twee onbekende (ROL, G08).
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify([{
      guid: CLUB, naam: 'Leuven Bears',
      teams: [
        { guid: `${CLUB}G12  9`, naam: 'G12 Z', categorie: 'Meisjes U12' },
        { guid: `${CLUB}ROL  9`, naam: 'ROL Z', categorie: 'Rolstoel' },
        { guid: `${CLUB}G08  9`, naam: 'G08 Z', categorie: 'Gemengd U8' },
      ],
    }]),
  });

  const r = await vraag(env, '/api/admin/teams',
    { methode: 'POST', alsWie: 'baas@club.be', body: { actie: 'laden' } });

  check('onbekende codes gemeld', r.json.onbekendeCategorieen.sort(), ['G08', 'ROL']);
  check('twee nieuwe ploegen uitgeschakeld', r.json.uitgeschakeld, 2);

  const rijen = (await env.DB.prepare(
    "SELECT guid, cat_code, volgen FROM teams WHERE guid LIKE '%  9' ORDER BY cat_code").all()).results;
  check('G08 staat uit', rijen.find((x) => x.cat_code === 'G08').volgen, 0);
  check('ROL staat uit', rijen.find((x) => x.cat_code === 'ROL').volgen, 0);
  check('G12 staat aan', rijen.find((x) => x.cat_code === 'G12').volgen, 1);
}

console.log('\n12. Een bewuste keuze blijft staan bij een tweede laadbeurt');
{
  const env = nieuweEnv();
  env.DB.exec(`INSERT INTO teams (guid, club_guid, naam, cat_code, volgen)
               VALUES ('${CLUB}ROL  9', '${CLUB}', 'ROL Z', 'ROL', 1)`);

  globalThis.fetch = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify([{
      guid: CLUB, naam: 'Leuven Bears',
      teams: [{ guid: `${CLUB}ROL  9`, naam: 'ROL Z', categorie: 'Rolstoel' }],
    }]),
  });

  const r = await vraag(env, '/api/admin/teams',
    { methode: 'POST', alsWie: 'baas@club.be', body: { actie: 'laden' } });
  check('bestaand team telt niet als nieuw uitgeschakeld', r.json.uitgeschakeld, 0);
  check('de keuze van de beheerder blijft',
    (await env.DB.prepare(`SELECT volgen FROM teams WHERE guid = '${CLUB}ROL  9'`).first()).volgen, 1);
}

console.log('\n13. Alles volgen, en alles uit');
{
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO teams (guid, club_guid, naam, cat_code, volgen) VALUES
      ('${CLUB}J18  1', '${CLUB}', 'J18 A', 'J18', 0),
      ('${CLUB}ROL  1', '${CLUB}', 'ROL A', 'ROL', 0),
      ('${CLUB}XXX  1', '${CLUB}', 'Zonder code', NULL, 0);
  `);

  const aan = await vraag(env, '/api/admin/teams/volgen',
    { methode: 'POST', alsWie: 'baas@club.be', body: { volgen: true } });
  check('overgeslagen wordt gemeld', aan.json.overgeslagen, 2);

  const na = (await env.DB.prepare('SELECT cat_code, volgen FROM teams').all()).results;
  check('bekende categorieën staan aan',
    na.filter((x) => ['G12', 'J16', 'J18'].includes(x.cat_code)).every((x) => x.volgen === 1), true);
  check('ROL blijft uit', na.find((x) => x.cat_code === 'ROL').volgen, 0);
  check('ploeg zonder code blijft uit', na.find((x) => x.cat_code === null).volgen, 0);

  await vraag(env, '/api/admin/teams/volgen',
    { methode: 'POST', alsWie: 'baas@club.be', body: { volgen: false } });
  const uit = (await env.DB.prepare('SELECT COUNT(*) AS n FROM teams WHERE volgen = 1').first()).n;
  check('alles uit zet ook de bekende categorieën uit', uit, 0);
}

console.log('\n14. Validatie en afscherming van de knop');
{
  const env = nieuweEnv();
  check('volgen moet een boolean zijn',
    (await vraag(env, '/api/admin/teams/volgen',
      { methode: 'POST', alsWie: 'baas@club.be', body: { volgen: 'ja' } })).status, 400);
  check('YO mag dit niet',
    (await vraag(env, '/api/admin/teams/volgen',
      { methode: 'POST', alsWie: 'yo@club.be', body: { volgen: true } })).status, 403);
}

console.log(mislukt === 0 ? '\n=== ALLE BEHEERTESTS GESLAAGD ===' : `\n=== ${mislukt} TESTS GEFAALD ===`);
process.exit(mislukt ? 1 : 0);
