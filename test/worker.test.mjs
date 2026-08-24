/**
 * Test van de Worker zelf: routering, authenticatie en de adminafscherming.
 *
 * De Worker wordt hier rechtstreeks aangeroepen met een nagebootste env en ctx.
 * Zo controleren we wat er gebeurt vóór een handler aan de beurt komt — precies
 * de laag die in de omzetting van Pages naar Workers nieuw is.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';

let mislukt = 0;
const check = (naam, echt, verwacht) => {
  const ok = JSON.stringify(echt) === JSON.stringify(verwacht);
  if (!ok) {
    mislukt++;
    console.log(`  FOUT ${naam}: kreeg ${JSON.stringify(echt)}, verwacht ${JSON.stringify(verwacht)}`);
  } else {
    console.log(`  ok   ${naam}`);
  }
};

const CLUB = 'BVBL1053';

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'BC Alpha');
    INSERT INTO teams (guid, club_guid, naam, yo, yo_plus)
      VALUES ('${CLUB}J16  1', '${CLUB}', 'U16 A', 1, 1);
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be',  'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('yo@club.be',    'Fluppe', 'Van Meerbeeck',  0, 'YO',  '${CLUB}'),
      ('los@club.be',   'Zonder', 'Club',           0, 'YO',  NULL),
      ('weg@club.be',   'Niet',   'Actief',         0, 'YO',  '${CLUB}');
    UPDATE users SET actief = 0 WHERE email = 'weg@club.be';
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, locatie, hash)
      VALUES ('M1', '2627', '${CLUB}', '${CLUB}J16  1', 'U16 A', 'BC Gamma',
              '2099-09-12', '20:30', 'Sporthal Noord', 'h1');
  `);
  return { DB: db, ENVIRONMENT: 'development', DEV_EMAIL: null };
}

/** Roept de Worker aan alsof we op localhost zitten, met een gegeven gebruiker. */
async function vraag(env, pad, { methode = 'GET', alsWie = null, body = null, ctx = {} } = {}) {
  const opties = { method: methode };
  if (body !== null) {
    opties.body = JSON.stringify(body);
    opties.headers = { 'Content-Type': 'application/json' };
  }
  const request = new Request(`http://localhost${pad}`, opties);
  const res = await worker.fetch(request, { ...env, DEV_EMAIL: alsWie }, ctx);
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json, res };
}

// ---------------------------------------------------------------------------
console.log('\n1. Routering');
{
  const env = nieuweEnv();
  check('onbekend eindpunt geeft 404',
    (await vraag(env, '/api/bestaat-niet', { alsWie: 'baas@club.be' })).status, 404);
  check('verkeerde methode geeft 405',
    (await vraag(env, '/api/me', { methode: 'POST', alsWie: 'baas@club.be' })).status, 405);

  const r = await vraag(env, '/api/me', { methode: 'DELETE', alsWie: 'baas@club.be' });
  check('405 vermeldt de toegestane methode', r.res.headers.get('Allow'), 'GET');

  const clubs = await vraag(env, '/api/admin/clubs', { methode: 'PUT', alsWie: 'baas@club.be' });
  check('meerdere methodes op één pad worden opgesomd',
    clubs.res.headers.get('Allow').split(', ').sort(), ['DELETE', 'PATCH', 'POST']);
}

console.log('\n2. Authenticatie');
{
  const env = nieuweEnv();
  check('zonder identiteit: 401', (await vraag(env, '/api/me')).status, 401);
  check('onbekend adres: 403',
    (await vraag(env, '/api/me', { alsWie: 'vreemde@elders.be' })).status, 403);
  check('inactief account: 403',
    (await vraag(env, '/api/me', { alsWie: 'weg@club.be' })).status, 403);

  const ok = await vraag(env, '/api/me', { alsWie: 'baas@club.be' });
  check('bekend adres: 200', ok.status, 200);
  check('weergavenaam samengesteld', ok.json.naam, 'Jurgen van Geijstelen');
  check('adminvlag doorgegeven', ok.json.isAdmin, true);
  check('seizoenlabel meegestuurd', ok.json.seizoen, '2026-2027');
}

console.log('\n3. Access voor Workers (ctx.access) krijgt voorrang');
{
  const env = nieuweEnv();
  const ctx = { access: { getIdentity: async () => ({ email: 'BAAS@Club.be' }) } };
  const r = await vraag(env, '/api/me', { ctx });
  check('identiteit uit ctx.access', r.json.email, 'baas@club.be');
  check('hoofdletters genormaliseerd', r.json.email, 'baas@club.be');
  check('bron vermeld', r.json.via, 'access-worker');
}

console.log('\n4. Adminafscherming');
{
  const env = nieuweEnv();
  for (const pad of ['/api/admin/config', '/api/admin/sync']) {
    check(`YO krijgt 403 op ${pad}`,
      (await vraag(env, pad, { alsWie: 'yo@club.be' })).status, 403);
    check(`admin krijgt 200 op ${pad}`,
      (await vraag(env, pad, { alsWie: 'baas@club.be' })).status, 200);
  }
  check('YO mag geen seizoen wijzigen',
    (await vraag(env, '/api/admin/season',
      { methode: 'POST', alsWie: 'yo@club.be', body: { actie: 'omhoog' } })).status, 403);
}

console.log('\n5. Beschikbaarheid zetten en wissen');
{
  const env = nieuweEnv();
  const zet = (wie, status) =>
    vraag(env, '/api/availability', { methode: 'POST', alsWie: wie, body: { matchGuid: 'M1', status } });

  check('YO zet beschikbaar', (await zet('yo@club.be', 'ja')).status, 200);
  check('staat in de lijst',
    (await vraag(env, '/api/matches', { alsWie: 'yo@club.be' })).json.matches[0].beschikbaarheid, 'ja');

  check('omzetten naar nee', (await zet('yo@club.be', 'nee')).status, 200);
  check('bijgewerkt',
    (await vraag(env, '/api/matches', { alsWie: 'yo@club.be' })).json.matches[0].beschikbaarheid, 'nee');

  check('wissen met null', (await zet('yo@club.be', null)).status, 200);
  check('terug op niet geantwoord',
    (await vraag(env, '/api/matches', { alsWie: 'yo@club.be' })).json.matches[0].beschikbaarheid, null);

  check('ongeldige status geweigerd', (await zet('yo@club.be', 'misschien')).status, 400);
  check('onbekende wedstrijd geweigerd',
    (await vraag(env, '/api/availability',
      { methode: 'POST', alsWie: 'yo@club.be', body: { matchGuid: 'BESTAAT-NIET', status: 'ja' } })).status, 404);
  check('gebruiker zonder club geweigerd',
    (await zet('los@club.be', 'ja')).status, 403);
}

console.log('\n6. De gebruiker komt nooit uit de body');
{
  const env = nieuweEnv();
  // Een YO probeert een beschikbaarheid op naam van iemand anders te zetten.
  await vraag(env, '/api/availability', {
    methode: 'POST',
    alsWie: 'yo@club.be',
    body: { matchGuid: 'M1', status: 'ja', user_email: 'baas@club.be', email: 'baas@club.be' },
  });
  const rij = await env.DB.prepare('SELECT user_email FROM availability').first();
  check('genegeerd, rij staat op de aanmelder', rij.user_email, 'yo@club.be');
}

console.log('\n7. Onzinnige invoer');
{
  const env = nieuweEnv();
  const request = new Request('http://localhost/api/availability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'dit is geen json',
  });
  const res = await worker.fetch(request, { ...nieuweEnv(), DEV_EMAIL: 'yo@club.be' }, {});
  check('kapotte JSON geeft 400, geen 500', res.status, 400);

  check('ontbrekende matchGuid geeft 400',
    (await vraag(env, '/api/availability',
      { methode: 'POST', alsWie: 'yo@club.be', body: { status: 'ja' } })).status, 400);
  check('ongeldige club-GUID geeft 400',
    (await vraag(env, '/api/admin/resolve-club?guid=ONZIN', { alsWie: 'baas@club.be' })).status, 400);
}

console.log('\n8. Statische bestanden gaan naar ASSETS');
{
  const env = nieuweEnv();
  let gevraagd = null;
  env.ASSETS = { fetch: async (req) => { gevraagd = new URL(req.url).pathname; return new Response('ok'); } };
  const res = await worker.fetch(new Request('http://localhost/'), env, {});
  check('/ wordt doorgegeven aan ASSETS', gevraagd, '/');
  check('en niet aan de API', res.status, 200);
}

console.log('\n9. Cron draait alleen op de juiste Brusselse uren');
{
  const env = nieuweEnv();
  const gedraaid = [];
  const ctx = { waitUntil: (p) => { gedraaid.push(p); return p; } };

  // 04:00 UTC = 06:00 in Brussel (zomertijd) -> moet draaien
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-12T04:00:00Z') }, env, ctx);
  check('zomer 04:00 UTC draait', gedraaid.length, 1);

  // 05:00 UTC = 07:00 in Brussel (zomertijd) -> moet niet draaien
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-12T05:00:00Z') }, env, ctx);
  check('zomer 05:00 UTC slaat over', gedraaid.length, 1);

  // 05:00 UTC = 06:00 in Brussel (wintertijd) -> moet draaien
  await worker.scheduled({ scheduledTime: Date.parse('2026-12-12T05:00:00Z') }, env, ctx);
  check('winter 05:00 UTC draait', gedraaid.length, 2);

  // 04:00 UTC = 05:00 in Brussel (wintertijd) -> moet niet draaien
  await worker.scheduled({ scheduledTime: Date.parse('2026-12-12T04:00:00Z') }, env, ctx);
  check('winter 04:00 UTC slaat over', gedraaid.length, 2);

  // middernacht: 23:00 UTC in de zomer, 22:00 UTC hoort niet
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-12T22:00:00Z') }, env, ctx);
  check('zomer 22:00 UTC draait (= middernacht Brussel)', gedraaid.length, 3);

  await Promise.allSettled(gedraaid);
}

console.log(mislukt === 0 ? '\n=== ALLE WORKERTESTS GESLAAGD ===' : `\n=== ${mislukt} TESTS GEFAALD ===`);
process.exit(mislukt ? 1 : 0);
