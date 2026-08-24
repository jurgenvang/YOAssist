/**
 * Tests voor de automatische toewijzing.
 * Eerst de rekenkern los, dan het geheel door de Worker.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { plan } from '../src/lib/autotoewijzing.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

const w = (guid, uur, { acc = 'A', nodig = 2, bezet = 0, datum = '2026-09-12' } = {}) =>
  ({ guid, datum, uur, accGuid: acc, nodig, bezet });

console.log('\n1. Basisverdeling');
{
  const r = plan({
    wedstrijden: [w('M1', '14:00')],
    kandidaten: new Map([['M1', ['a@x.be', 'b@x.be', 'c@x.be']]]),
  });
  check('twee toegewezen', r.aantalToegewezen, 2);
  check('niets onvolledig', r.aantalOnvolledig, 0);
  check('de twee eerste alfabetisch bij gelijke stand',
    r.toewijzingen.map((t) => t.email), ['a@x.be', 'b@x.be']);
}

console.log('\n2. Eerlijk verdelen op basis van wat iemand al heeft');
{
  const r = plan({
    wedstrijden: [w('M1', '14:00', { nodig: 1 })],
    kandidaten: new Map([['M1', ['veel@x.be', 'weinig@x.be']]]),
    telling: new Map([['veel@x.be', 5], ['weinig@x.be', 1]]),
  });
  check('wie het minst heeft, komt eerst', r.toewijzingen[0].email, 'weinig@x.be');
}

{
  // Drie wedstrijden, twee kandidaten: de last moet afwisselen.
  const r = plan({
    wedstrijden: [
      w('M1', '10:00', { nodig: 1 }),
      w('M2', '14:00', { nodig: 1 }),
      w('M3', '18:00', { nodig: 1 }),
    ],
    kandidaten: new Map([
      ['M1', ['a@x.be', 'b@x.be']],
      ['M2', ['a@x.be', 'b@x.be']],
      ['M3', ['a@x.be', 'b@x.be']],
    ]),
  });
  const per = Object.fromEntries(r.verdeling.map((v) => [v.email, v.aantal]));
  check('twee tegen één, niet drie tegen nul', [per['a@x.be'], per['b@x.be']].sort(), [1, 2]);
}

console.log('\n3. Botsingen worden vermeden');
{
  const r = plan({
    wedstrijden: [w('M1', '14:00', { nodig: 1 }), w('M2', '15:00', { nodig: 1 })],
    kandidaten: new Map([['M1', ['a@x.be']], ['M2', ['a@x.be']]]),
  });
  check('slechts één van de twee', r.aantalToegewezen, 1);
  check('de andere blijft open', r.aantalOnvolledig, 1);
  check('met reden', /botsen/.test(r.onvolledig[0].reden), true);
}

{
  // Ruim genoeg uit elkaar: allebei mag.
  const r = plan({
    wedstrijden: [w('M1', '10:00', { nodig: 1 }), w('M2', '14:00', { nodig: 1 })],
    kandidaten: new Map([['M1', ['a@x.be']], ['M2', ['a@x.be']]]),
  });
  check('vier uur ertussen mag', r.aantalToegewezen, 2);
}

{
  // Andere zaal vraagt een half uur extra.
  const krap = plan({
    wedstrijden: [w('M1', '14:00', { nodig: 1, acc: 'A' }), w('M2', '16:00', { nodig: 1, acc: 'B' })],
    kandidaten: new Map([['M1', ['a@x.be']], ['M2', ['a@x.be']]]),
  });
  check('twee uur naar een andere zaal is te krap', krap.aantalToegewezen, 1);

  const ruim = plan({
    wedstrijden: [w('M1', '14:00', { nodig: 1, acc: 'A' }), w('M2', '16:30', { nodig: 1, acc: 'B' })],
    kandidaten: new Map([['M1', ['a@x.be']], ['M2', ['a@x.be']]]),
  });
  check('tweeënhalf uur wel', ruim.aantalToegewezen, 2);
}

console.log('\n4. Bestaande aanduidingen tellen mee');
{
  const r = plan({
    wedstrijden: [w('M2', '15:00', { nodig: 1 })],
    kandidaten: new Map([['M2', ['a@x.be', 'b@x.be']]]),
    agenda: new Map([['a@x.be', [{ guid: 'M1', datum: '2026-09-12', uur: '14:00', accGuid: 'A' }]]]),
  });
  check('wie al bezig is, wordt overgeslagen', r.toewijzingen[0].email, 'b@x.be');
}

{
  const r = plan({
    wedstrijden: [w('M1', '14:00', { nodig: 2, bezet: 1 })],
    kandidaten: new Map([['M1', ['a@x.be', 'b@x.be']]]),
  });
  check('half bezette wedstrijd krijgt er nog één', r.aantalToegewezen, 1);
}

console.log('\n5. Schaarste eerst');
{
  // M1 heeft één kandidaat, M2 heeft er twee waaronder diezelfde persoon.
  // Zou M2 eerst behandeld worden, dan blijft M1 leeg.
  const r = plan({
    wedstrijden: [w('M2', '18:00', { nodig: 1 }), w('M1', '10:00', { nodig: 1 })],
    kandidaten: new Map([['M1', ['schaars@x.be']], ['M2', ['schaars@x.be', 'ander@x.be']]]),
  });
  check('beide ingevuld', r.aantalToegewezen, 2);
  check('de schaarse op de schaarse wedstrijd',
    r.toewijzingen.find((t) => t.guid === 'M1').email, 'schaars@x.be');
}

console.log('\n6. Zonder kandidaten');
{
  const r = plan({ wedstrijden: [w('M1', '14:00')], kandidaten: new Map() });
  check('niets toegewezen', r.aantalToegewezen, 0);
  check('reden vermeld', r.onvolledig[0].reden, 'niemand heeft zich beschikbaar gezet');
  check('tekort geteld', r.onvolledig[0].tekort, 2);
}

console.log('\n7. Dezelfde invoer geeft altijd hetzelfde resultaat');
{
  const invoer = () => ({
    wedstrijden: [w('M1', '10:00', { nodig: 2 }), w('M2', '16:00', { nodig: 2 })],
    kandidaten: new Map([
      ['M1', ['a@x.be', 'b@x.be', 'c@x.be']],
      ['M2', ['b@x.be', 'c@x.be', 'd@x.be']],
    ]),
  });
  const een = plan(invoer());
  const twee = plan(invoer());
  check('reproduceerbaar', een.toewijzingen, twee.toewijzingen);
}

console.log('\n8. De aanroeper wordt niet gewijzigd');
{
  const telling = new Map([['a@x.be', 3]]);
  const agenda = new Map([['a@x.be', []]]);
  plan({
    wedstrijden: [w('M1', '14:00', { nodig: 1 })],
    kandidaten: new Map([['M1', ['a@x.be']]]),
    telling, agenda,
  });
  check('telling ongemoeid', telling.get('a@x.be'), 3);
  check('agenda ongemoeid', agenda.get('a@x.be').length, 0);
}

// ---------------------------------------------------------------------------
const CLUB = 'BVBL1125';
const morgen = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const d = morgen();
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES
      ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12'),
      ('${CLUB}J16  1', '${CLUB}', 'J16 A', 'J16');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('ann@club.be',  'Ann',    'Aerts',          0, 'YO',  '${CLUB}'),
      ('bert@club.be', 'Bert',   'Bosmans',        0, 'YO+', '${CLUB}'),
      ('cis@club.be',  'Cis',    'Claes',          0, 'YO+', '${CLUB}');
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, acc_guid, cat_code, off_namen, off_aantal, scope, scope_reden, hash) VALUES
      ('U12A','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast','${d}','10:00','ACC1','G12','[]',0,1,'auto','h1'),
      ('U12B','2627','${CLUB}','${CLUB}G12  1','G12 B','Gast','${d}','14:00','ACC1','G12','[]',0,1,'auto','h2'),
      ('J16A','2627','${CLUB}','${CLUB}J16  1','J16 A','Gast','${d}','18:00','ACC1','J16','["Yves"]',1,1,'woensdag','h3');
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

const auto = (env, opties = {}) =>
  vraag(env, '/api/admin/auto', { methode: 'POST', body: opties });

console.log('\n9. Droogloop verandert niets');
{
  const env = nieuweEnv();
  env.DB.exec(`INSERT INTO availability (user_email, match_guid, status) VALUES
    ('ann@club.be','U12A','ja'), ('bert@club.be','U12A','ja')`);

  const r = await auto(env);
  check('voorstel gemaakt', r.json.aantalToegewezen, 2);
  check('niet uitgevoerd', r.json.uitgevoerd, false);
  check('databank ongemoeid',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM assignments').first()).n, 0);
  check('namen meegegeven', r.json.toewijzingen.map((t) => t.naam).sort(), ['Ann Aerts', 'Bert Bosmans']);
}

console.log('\n10. Uitvoeren schrijft weg');
{
  const env = nieuweEnv();
  env.DB.exec(`INSERT INTO availability (user_email, match_guid, status) VALUES
    ('ann@club.be','U12A','ja'), ('bert@club.be','U12A','ja')`);

  const r = await auto(env, { uitvoeren: true });
  check('uitgevoerd', r.json.uitgevoerd, true);
  check('twee rijen', (await env.DB.prepare('SELECT COUNT(*) AS n FROM assignments').first()).n, 2);
  check('herkomst genoteerd',
    /automatisch/.test((await env.DB.prepare('SELECT toegewezen_door FROM assignments LIMIT 1').first()).toegewezen_door), true);

  const nogmaals = await auto(env, { uitvoeren: true });
  check('tweede run vindt niets meer', nogmaals.json.aantalToegewezen, 0);
}

console.log('\n11. Profiel en club worden gerespecteerd');
{
  const env = nieuweEnv();
  // Ann is YO en zet zich beschikbaar voor een J16-wedstrijd: mag niet meetellen.
  env.DB.exec(`INSERT INTO availability (user_email, match_guid, status) VALUES
    ('ann@club.be','J16A','ja'), ('bert@club.be','J16A','ja')`);

  const r = await auto(env, { uitvoeren: true });
  check('slechts één plaats te vergeven', r.json.aantalToegewezen, 1);
  check('en die gaat naar de YO+', r.json.toewijzingen[0].naam, 'Bert Bosmans');
}

console.log('\n12. Bestaande handmatige aanduidingen blijven staan');
{
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO assignments (match_guid, user_email, toegewezen_door)
      VALUES ('U12A', 'cis@club.be', 'baas@club.be');
    INSERT INTO availability (user_email, match_guid, status) VALUES
      ('ann@club.be','U12A','ja'), ('bert@club.be','U12A','ja');
  `);

  const r = await auto(env, { uitvoeren: true });
  check('er wordt nog één aangevuld', r.json.aantalToegewezen, 1);
  const wie = await env.DB.prepare(
    "SELECT user_email FROM assignments WHERE match_guid='U12A' ORDER BY user_email").all();
  check('Cis blijft staan', wie.results.map((x) => x.user_email).includes('cis@club.be'), true);
  check('totaal twee', wie.results.length, 2);
}

console.log('\n13. Onvolledige wedstrijden worden gemeld');
{
  const env = nieuweEnv();
  env.DB.exec(`INSERT INTO availability (user_email, match_guid, status) VALUES ('ann@club.be','U12A','ja')`);

  const r = await auto(env);
  check('één toegewezen', r.json.aantalToegewezen, 1);
  const open = r.json.onvolledig.find((o) => o.guid === 'U12A');
  check('tekort van één gemeld', open.tekort, 1);
  check('met omschrijving', /G12 A/.test(open.wedstrijd), true);
}

console.log('\n14. Enkel beheerders');
{
  const env = nieuweEnv();
  check('YO krijgt 403', (await auto({ ...env }, {})).status, 200);
  check('YO krijgt echt 403',
    (await vraag(env, '/api/admin/auto', { methode: 'POST', alsWie: 'ann@club.be', body: {} })).status, 403);
}

console.log(f === 0 ? '\n=== ALLE AUTOTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
