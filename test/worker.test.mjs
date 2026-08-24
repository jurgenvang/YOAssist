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
    INSERT INTO teams (guid, club_guid, naam, cat_code, yo, yo_plus)
      VALUES ('${CLUB}J16  1', '${CLUB}', 'U16 A', 'J16', 1, 1);
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

console.log('\n12. Categorie in het beheerscherm');
{
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES
      ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12'),
      ('${CLUB}ROL  1', '${CLUB}', 'ROL A', 'ROL'),
      ('${CLUB}XXX  1', '${CLUB}', 'Zonder code', NULL);
  `);

  const r = await vraag(env, '/api/admin/config', { alsWie: 'baas@club.be' });
  const per = Object.fromEntries(r.json.teams.map((t) => [t.naam, t]));

  check('gekende categorie krijgt label', per['G12 A'].catLabel, 'U12');
  check('en een tarief', per['G12 A'].tariefCent, 1500);
  check('en wordt als bekend gemarkeerd', per['G12 A'].catBekend, true);

  check('ROL heeft wel een code', per['ROL A'].catCode, 'ROL');
  check('maar geldt als onbekend', per['ROL A'].catBekend, false);
  check('en heeft geen tarief', per['ROL A'].tariefCent, null);

  check('ploeg zonder code ook onbekend', per['Zonder code'].catBekend, false);

  const j16 = per['U16 A'];
  check('bestaande ploeg behoudt haar categorie', j16.catLabel, 'U16');
  check('U16-tarief', j16.tariefCent, 2000);
}

console.log('\n10. Versienummer');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/me', { alsWie: 'baas@club.be' });
  check('versie meegestuurd', /^\d+\.\d+\.\d+$/.test(r.json.versie), true);
}

console.log('\n11. Clubkoppeling');
{
  // Eén club geconfigureerd: stilzwijgend koppelen, geen keuze tonen.
  const env = nieuweEnv();
  env.DB.exec("UPDATE users SET club_guid = NULL WHERE email = 'yo@club.be'");

  const r = await vraag(env, '/api/me', { alsWie: 'yo@club.be' });
  check('bij één club automatisch gekoppeld', r.json.clubGuid, CLUB);
  check('als automatisch gemarkeerd', r.json.clubAutomatisch, true);
  check('geen keuze nodig', r.json.clubKeuze, null);

  const bewaard = await env.DB.prepare('SELECT club_guid FROM users WHERE email = ?')
    .bind('yo@club.be').first();
  check('ook echt bewaard', bewaard.club_guid, CLUB);
}

{
  // Twee clubs: de gebruiker moet kiezen, met de namen erbij.
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('BVBL2000', 'BC Beta');
    UPDATE users SET club_guid = NULL WHERE email = 'yo@club.be';
  `);

  const r = await vraag(env, '/api/me', { alsWie: 'yo@club.be' });
  check('niet automatisch gekoppeld', r.json.clubGuid, null);
  check('keuze aangeboden', r.json.clubKeuze.reden, 'meerdere-clubs');
  check('namen meegestuurd', r.json.clubKeuze.clubs.map((c) => c.naam), ['BC Alpha', 'BC Beta']);

  const m = await vraag(env, '/api/matches', { alsWie: 'yo@club.be' });
  check('matches geeft dezelfde keuze', m.json.clubKeuze.reden, 'meerdere-clubs');
  check('en geen wedstrijden', m.json.matches.length, 0);

  const gekozen = await vraag(env, '/api/club',
    { methode: 'POST', alsWie: 'yo@club.be', body: { guid: 'BVBL2000' } });
  check('keuze aanvaard', gekozen.json.clubNaam, 'BC Beta');
  check('daarna geen keuze meer',
    (await vraag(env, '/api/me', { alsWie: 'yo@club.be' })).json.clubKeuze, null);
}

{
  // Geen enkele club geconfigureerd.
  const env = nieuweEnv();
  env.DB.exec("UPDATE users SET club_guid = NULL; DELETE FROM clubs;");
  const r = await vraag(env, '/api/me', { alsWie: 'yo@club.be' });
  check('meldt dat er geen clubs zijn', r.json.clubKeuze.reden, 'geen-clubs');
}

{
  // Een club die niet geconfigureerd of niet actief is, mag niet gekozen worden.
  const env = nieuweEnv();
  env.DB.exec("INSERT INTO clubs (guid, naam, actief) VALUES ('BVBL3000', 'BC Inactief', 0)");

  check('onbekende club geweigerd',
    (await vraag(env, '/api/club',
      { methode: 'POST', alsWie: 'yo@club.be', body: { guid: 'BVBL9999' } })).status, 404);
  check('inactieve club geweigerd',
    (await vraag(env, '/api/club',
      { methode: 'POST', alsWie: 'yo@club.be', body: { guid: 'BVBL3000' } })).status, 404);
  check('lege guid geweigerd',
    (await vraag(env, '/api/club',
      { methode: 'POST', alsWie: 'yo@club.be', body: { guid: '' } })).status, 400);

  const nog = await env.DB.prepare('SELECT club_guid FROM users WHERE email = ?')
    .bind('yo@club.be').first();
  check('club ongewijzigd na weigering', nog.club_guid, CLUB);
}

{
  // /api/clubs geeft alleen actieve clubs.
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO clubs (guid, naam, actief) VALUES
      ('BVBL2000', 'BC Beta', 1), ('BVBL3000', 'BC Inactief', 0);
  `);
  const r = await vraag(env, '/api/clubs', { alsWie: 'yo@club.be' });
  check('inactieve club niet in de lijst', r.json.clubs.map((c) => c.naam), ['BC Alpha', 'BC Beta']);
}

console.log(mislukt === 0 ? '\n=== ALLE WORKERTESTS GESLAAGD ===' : `\n=== ${mislukt} TESTS GEFAALD ===`);
process.exit(mislukt ? 1 : 0);
