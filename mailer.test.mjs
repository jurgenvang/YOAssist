/**
 * Tests voor de mailconfiguratie. Er wordt nooit echt verstuurd; fetch is
 * altijd nagebootst.
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

function nieuweEnv(extra = {}) {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO users (email, voornaam, achternaam, is_admin, profiel)
           VALUES ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+')`);
  return { DB: db, ENVIRONMENT: 'development', ...extra };
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'baas@club.be', body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json };
}

console.log('\n1. Standaardtoestand: leeg en inactief');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/admin/mail');
  check('leeg afzenderadres', r.json.afzender, '');
  check('standaardnaam', r.json.afzenderNaam, 'YOAssist');
  check('geen sleutel aanwezig', r.json.apiSleutelAanwezig, false);
  check('niet actief', r.json.actief, false);
}

console.log('\n2. Afzender instellen');
{
  const env = nieuweEnv();
  const zet = await vraag(env, '/api/admin/mail', {
    methode: 'POST', body: { afzender: 'Aanduidingen@JouwClub.be', afzenderNaam: 'YOAssist Bears' },
  });
  check('bewaard', zet.status, 200);
  check('adres genormaliseerd', zet.json.afzender, 'aanduidingen@jouwclub.be');
  check('herinnering over verificatie', /geverifieerd/.test(zet.json.herinnering), true);

  const na = await vraag(env, '/api/admin/mail');
  check('blijft bewaard', na.json.afzender, 'aanduidingen@jouwclub.be');
  check('nog steeds niet actief zonder sleutel', na.json.actief, false);
}

console.log('\n3. Validatie');
{
  const env = nieuweEnv();
  check('ongeldig adres geweigerd',
    (await vraag(env, '/api/admin/mail', { methode: 'POST', body: { afzender: 'geen adres', afzenderNaam: 'X' } })).status, 400);
  check('naam verplicht',
    (await vraag(env, '/api/admin/mail', { methode: 'POST', body: { afzender: 'x@y.be', afzenderNaam: '' } })).status, 400);
  check('leeg adres mag (uitschakelen)',
    (await vraag(env, '/api/admin/mail', { methode: 'POST', body: { afzender: '', afzenderNaam: 'YOAssist' } })).status, 200);
}

console.log('\n4. Actief pas met beide: adres én secret');
{
  const env = nieuweEnv({ RESEND_API_KEY: 're_test_123' });
  await vraag(env, '/api/admin/mail', { methode: 'POST', body: { afzender: 'a@b.be', afzenderNaam: 'X' } });
  const r = await vraag(env, '/api/admin/mail');
  check('sleutel aanwezig', r.json.apiSleutelAanwezig, true);
  check('nu wel actief', r.json.actief, true);
  check('de sleutel zelf komt nooit mee', JSON.stringify(r.json).includes('re_test_123'), false);
}

console.log('\n5. Testmail: geslaagd pad');
{
  const env = nieuweEnv({ RESEND_API_KEY: 're_test_123' });
  await vraag(env, '/api/admin/mail', { methode: 'POST', body: { afzender: 'a@club.be', afzenderNaam: 'YOAssist' } });

  let verstuurdeAanvraag = null;
  globalThis.fetch = async (url, opties) => {
    verstuurdeAanvraag = { url, opties };
    return { ok: true, json: async () => ({ id: 'abc123' }) };
  };

  const r = await vraag(env, '/api/admin/mail/test', { methode: 'POST' });
  check('gelukt', r.status, 200);
  check('naar de aanroepende beheerder', r.json.naar, 'baas@club.be');
  check('juiste endpoint', verstuurdeAanvraag.url, 'https://api.resend.com/emails');
  check('sleutel in de header', verstuurdeAanvraag.opties.headers.Authorization, 'Bearer re_test_123');

  const body = JSON.parse(verstuurdeAanvraag.opties.body);
  check('afzender in de body', body.from, 'YOAssist <a@club.be>');
  check('bestemming', body.to, 'baas@club.be');
}

console.log('\n6. Testmail: ontbrekende configuratie');
{
  const env = nieuweEnv();
  check('zonder afzender', (await vraag(env, '/api/admin/mail/test', { methode: 'POST' })).status, 400);

  await vraag(env, '/api/admin/mail', { methode: 'POST', body: { afzender: 'a@club.be', afzenderNaam: 'X' } });
  check('zonder sleutel', (await vraag(env, '/api/admin/mail/test', { methode: 'POST' })).status, 400);
}

console.log('\n7. Testmail: Resend weigert');
{
  const env = nieuweEnv({ RESEND_API_KEY: 're_test_123' });
  await vraag(env, '/api/admin/mail', { methode: 'POST', body: { afzender: 'a@ongeverifieerd.be', afzenderNaam: 'X' } });

  globalThis.fetch = async () => ({
    ok: false, status: 403, json: async () => ({ message: 'Domain not verified' }),
  });

  const r = await vraag(env, '/api/admin/mail/test', { methode: 'POST' });
  check('foutstatus doorgegeven', r.status, 502);
  check('foutboodschap van Resend zichtbaar', r.json.detail, 'Domain not verified');
}

console.log('\n8. Enkel beheerders komen bij mailconfiguratie');
{
  const env = nieuweEnv();
  env.DB.exec(`INSERT INTO users (email, voornaam, achternaam, is_admin, profiel)
               VALUES ('yo@club.be', 'Ann', 'Aerts', 0, 'YO')`);
  check('YO krijgt 403 op GET',
    (await vraag(env, '/api/admin/mail', { alsWie: 'yo@club.be' })).status, 403);
  check('YO krijgt 403 op de testmail',
    (await vraag(env, '/api/admin/mail/test', { methode: 'POST', alsWie: 'yo@club.be' })).status, 403);
}

console.log('\n9. Testmodus zonder domein');
{
  const env = nieuweEnv({ RESEND_API_KEY: 're_test_123' });
  await vraag(env, '/api/admin/mail', {
    methode: 'POST', body: { afzender: 'onboarding@resend.dev', afzenderNaam: 'YOAssist' },
  });

  const r = await vraag(env, '/api/admin/mail');
  check('herkend als zandbak', r.json.zandbak, true);
  check('wel actief', r.json.actief, true);
  check('maar niet naar anderen', r.json.magNaarAnderen, false);

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: 'x' }) });
  const test = await vraag(env, '/api/admin/mail/test', { methode: 'POST' });
  check('testmail lukt', test.status, 200);
  check('gemeld als zandbak', test.json.zandbak, true);
}

console.log('\n10. Eigen domein mag wel naar anderen');
{
  const env = nieuweEnv({ RESEND_API_KEY: 're_test_123' });
  await vraag(env, '/api/admin/mail', {
    methode: 'POST', body: { afzender: 'aanduidingen@jouwclub.be', afzenderNaam: 'YOAssist' },
  });
  const r = await vraag(env, '/api/admin/mail');
  check('geen zandbak', r.json.zandbak, false);
  check('mag naar anderen', r.json.magNaarAnderen, true);
}

console.log(f === 0 ? '\n=== ALLE MAILTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
