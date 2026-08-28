/**
 * Tests voor het invullen namens een kind.
 *
 * Wat hier vooral vastligt: dat niemand kan handelen namens iemand aan wie hij
 * niet gekoppeld is. Dat is het enige wat echt mis kan gaan.
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
const morgen = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES
      ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12'),
      ('${CLUB}J16  1', '${CLUB}', 'J16 A', 'J16');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('papa@club.be', 'Piet',   'Peeters',        0, 'YO',  '${CLUB}'),
      ('jan@club.be',  'Jan',    'Peeters',        0, 'YO',  '${CLUB}'),
      ('pieter@club.be','Pieter','Peeters',        0, 'YO+', '${CLUB}'),
      ('vreemde@club.be','Vreemde','Snuiter',      0, 'YO',  '${CLUB}');
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_aantal, scope, scope_reden, hash) VALUES
      ('U12','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast','${morgen()}','14:00','G12',0,1,'auto','h1'),
      ('J16','2627','${CLUB}','${CLUB}J16  1','J16 A','Gast','${morgen()}','18:00','J16',0,1,'admin','h2');
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

const koppel = (env, ouder, kind) =>
  vraag(env, '/api/admin/users/ouder', { methode: 'POST', body: { ouder, kind } });

console.log('\n1. Koppelen door een beheerder');
{
  const env = nieuweEnv();
  const r = await koppel(env, 'papa@club.be', 'jan@club.be');
  check('gekoppeld', r.status, 200);

  const ik = await vraag(env, '/api/me', { alsWie: 'papa@club.be' });
  check('papa ziet zijn kind', ik.json.kinderen.map((k) => k.naam), ['Jan Peeters']);

  await koppel(env, 'papa@club.be', 'pieter@club.be');
  const beide = await vraag(env, '/api/me', { alsWie: 'papa@club.be' });
  check('twee kinderen', beide.json.kinderen.length, 2);

  const kind = await vraag(env, '/api/me', { alsWie: 'jan@club.be' });
  check('een kind heeft zelf geen kinderen', kind.json.kinderen, []);
}

console.log('\n2. Meerdere ouders per kind');
{
  const env = nieuweEnv();
  await koppel(env, 'papa@club.be', 'jan@club.be');
  await koppel(env, 'vreemde@club.be', 'jan@club.be');

  check('beide ouders zien het kind',
    (await vraag(env, '/api/me', { alsWie: 'vreemde@club.be' })).json.kinderen.length, 1);
  check('en de eerste ook',
    (await vraag(env, '/api/me', { alsWie: 'papa@club.be' })).json.kinderen.length, 1);
}

console.log('\n3. De lijst van het kind ophalen');
{
  const env = nieuweEnv();
  await koppel(env, 'papa@club.be', 'pieter@club.be');

  // Papa is YO en ziet enkel U10/U12; Pieter is YO+ en ziet alles.
  const eigen = await vraag(env, '/api/matches', { alsWie: 'papa@club.be' });
  check('papa ziet enkel U12', eigen.json.matches.map((m) => m.guid), ['U12']);
  check('en handelt voor zichzelf', eigen.json.namens, null);

  const kind = await vraag(env, '/api/matches?namens=pieter@club.be', { alsWie: 'papa@club.be' });
  check('namens Pieter: het profiel van het kind telt',
    kind.json.matches.map((m) => m.guid).sort(), ['J16', 'U12']);
  check('en dat wordt gemeld', kind.json.namens.naam, 'Pieter Peeters');
}

console.log('\n4. Beschikbaarheid zetten namens een kind');
{
  const env = nieuweEnv();
  await koppel(env, 'papa@club.be', 'jan@club.be');

  const r = await vraag(env, '/api/availability', {
    methode: 'POST', alsWie: 'papa@club.be',
    body: { matchGuid: 'U12', status: 'ja', namens: 'jan@club.be' },
  });
  check('gelukt', r.status, 200);

  const rij = await env.DB
    .prepare('SELECT user_email, status FROM availability WHERE match_guid = ?')
    .bind('U12').first();
  check('op de rij van het kind', rij.user_email, 'jan@club.be');
  check('met de juiste status', rij.status, 'ja');

  const papaEigen = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM availability WHERE user_email = 'papa@club.be'").first();
  check('en niet op die van de ouder', papaEigen.n, 0);
}

console.log('\n5. Zonder koppeling mag het niet');
{
  const env = nieuweEnv();
  await koppel(env, 'papa@club.be', 'jan@club.be');

  const lijst = await vraag(env, '/api/matches?namens=vreemde@club.be', { alsWie: 'papa@club.be' });
  check('lijst van een vreemde geweigerd', lijst.status, 403);

  const zet = await vraag(env, '/api/availability', {
    methode: 'POST', alsWie: 'papa@club.be',
    body: { matchGuid: 'U12', status: 'ja', namens: 'vreemde@club.be' },
  });
  check('invullen voor een vreemde geweigerd', zet.status, 403);
  check('en er is niets weggeschreven',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM availability').first()).n, 0);

  // Ook een kind kan niet omgekeerd namens zijn ouder handelen.
  const omgekeerd = await vraag(env, '/api/matches?namens=papa@club.be', { alsWie: 'jan@club.be' });
  check('omgekeerd mag ook niet', omgekeerd.status, 403);
}

console.log('\n6. Ontkoppelen');
{
  const env = nieuweEnv();
  await koppel(env, 'papa@club.be', 'jan@club.be');
  await vraag(env, '/api/admin/users/ouder?ouder=papa@club.be&kind=jan@club.be',
    { methode: 'DELETE' });

  check('geen kinderen meer',
    (await vraag(env, '/api/me', { alsWie: 'papa@club.be' })).json.kinderen, []);
  check('en handelen mag niet meer',
    (await vraag(env, '/api/matches?namens=jan@club.be', { alsWie: 'papa@club.be' })).status, 403);
}

console.log('\n7. Validatie en afscherming');
{
  const env = nieuweEnv();
  check('zichzelf koppelen kan niet',
    (await koppel(env, 'papa@club.be', 'papa@club.be')).status, 400);
  check('onbekend adres', (await koppel(env, 'papa@club.be', 'bestaatniet@club.be')).status, 404);

  // Geen ketens: wie zelf al ouder is, kan geen kind worden.
  await koppel(env, 'papa@club.be', 'jan@club.be');
  check('geen ketens', (await koppel(env, 'vreemde@club.be', 'papa@club.be')).status, 409);

  check('een YO mag niet koppelen',
    (await vraag(env, '/api/admin/users/ouder',
      { methode: 'POST', alsWie: 'papa@club.be',
        body: { ouder: 'papa@club.be', kind: 'pieter@club.be' } })).status, 403);
}

console.log('\n8. Het kind houdt zijn eigen overzicht');
{
  const env = nieuweEnv();
  await koppel(env, 'papa@club.be', 'jan@club.be');

  // De vergoeding rekent per official, dus het kind heeft zijn eigen overzicht
  // ongeacht wie de beschikbaarheid invulde.
  const kind = await vraag(env, '/api/vergoeding', { alsWie: 'jan@club.be' });
  check('het kind kan zijn eigen overzicht opvragen', kind.status, 200);

  const ouder = await vraag(env, '/api/vergoeding', { alsWie: 'papa@club.be' });
  check('de ouder ziet zijn eigen overzicht', ouder.status, 200);
  check('die twee staan los van elkaar',
    kind.json.seizoenTotaalCent === 0 && ouder.json.seizoenTotaalCent === 0, true);
}

console.log(f === 0 ? '\n=== ALLE NAMENSTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
