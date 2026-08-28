/**
 * Tests voor push: de cryptografie, de voorkeuren, en het gedeelde
 * verzendkanaal.
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { maakVapidSleutels, versleutel, stuurPush, b64urlNaarBytes, bytesNaarB64url } from '../src/lib/push.js';
import { verwittig } from '../src/lib/verwittigen.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

console.log('\n1. base64url heen en weer');
{
  const bytes = new Uint8Array([0, 1, 250, 255, 128, 64]);
  check('rondrit blijft gelijk', [...b64urlNaarBytes(bytesNaarB64url(bytes))], [...bytes]);
  check('geen opvultekens', /[=+/]/.test(bytesNaarB64url(bytes)), false);
}

console.log('\n2. VAPID-sleutels');
{
  const sleutels = await maakVapidSleutels();
  check('publieke sleutel is 65 bytes', b64urlNaarBytes(sleutels.publiek).length, 65);
  check('ongecomprimeerd punt begint met 0x04', b64urlNaarBytes(sleutels.publiek)[0], 4);
  check('private sleutel is 32 bytes', b64urlNaarBytes(sleutels.prive).length, 32);

  const tweede = await maakVapidSleutels();
  check('elke oproep geeft een nieuw paar', sleutels.publiek === tweede.publiek, false);
}

/** Bootst een browserabonnement na met een echt ECDH-sleutelpaar. */
async function nepAbonnement() {
  const paar = await webcrypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  );
  const publiek = await webcrypto.subtle.exportKey('raw', paar.publicKey);
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    p256dh: bytesNaarB64url(publiek),
    auth: bytesNaarB64url(webcrypto.getRandomValues(new Uint8Array(16))),
    prive: paar.privateKey,
  };
}

console.log('\n3. Versleuteling');
{
  const abo = await nepAbonnement();
  const inhoud = await versleutel(JSON.stringify({ titel: 'Test' }), abo.p256dh, abo.auth);

  // Kopstuk: 16 zout + 4 recordgrootte + 1 lengte + 65 sleutel = 86 bytes.
  check('kopstuk heeft de juiste vorm', inhoud[20], 65);
  check('lang genoeg voor kopstuk plus inhoud', inhoud.length > 86, true);

  const recordGrootte = new DataView(inhoud.buffer, inhoud.byteOffset + 16, 4).getUint32(0);
  check('recordgrootte 4096', recordGrootte, 4096);

  const tweede = await versleutel(JSON.stringify({ titel: 'Test' }), abo.p256dh, abo.auth);
  check('elke versleuteling is uniek (vers zout en sleutel)',
    bytesNaarB64url(inhoud) === bytesNaarB64url(tweede), false);
}

console.log('\n4. Versturen');
{
  const abo = await nepAbonnement();
  const sleutels = await maakVapidSleutels();
  const opties = { ...sleutels, onderwerp: 'mailto:test@club.be' };

  let verzoek = null;
  globalThis.fetch = async (url, opts) => { verzoek = { url, opts }; return { ok: true, status: 201 }; };

  const r = await stuurPush(abo, { titel: 'Hallo' }, opties);
  check('gelukt', r.verstuurd, true);
  check('naar het endpoint', verzoek.url, abo.endpoint);
  check('juiste content-encoding', verzoek.opts.headers['Content-Encoding'], 'aes128gcm');
  check('VAPID-header met token en sleutel',
    /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(verzoek.opts.headers.Authorization), true);

  // Het JWT moet ontleedbaar zijn en de juiste aud bevatten.
  const jwt = verzoek.opts.headers.Authorization.match(/t=([^,]+)/)[1];
  const payload = JSON.parse(new TextDecoder().decode(b64urlNaarBytes(jwt.split('.')[1])));
  check('aud is de oorsprong van het endpoint', payload.aud, 'https://fcm.googleapis.com');
  check('met een onderwerp', payload.sub, 'mailto:test@club.be');
  check('en een vervaldatum in de toekomst', payload.exp > Math.floor(Date.now() / 1000), true);
}

console.log('\n5. Verlopen abonnementen worden herkend');
{
  const abo = await nepAbonnement();
  const sleutels = await maakVapidSleutels();
  const opties = { ...sleutels, onderwerp: 'mailto:test@club.be' };

  for (const status of [404, 410]) {
    globalThis.fetch = async () => ({ ok: false, status });
    const r = await stuurPush(abo, { titel: 'X' }, opties);
    check(`status ${status} betekent verlopen`, r.verlopen, true);
  }

  globalThis.fetch = async () => ({ ok: false, status: 500 });
  const serverfout = await stuurPush(abo, { titel: 'X' }, opties);
  check('een serverfout is niet verlopen', serverfout.verlopen, undefined);

  const zonder = await stuurPush(abo, { titel: 'X' }, { onderwerp: 'mailto:x@y.be' });
  check('zonder sleutels wordt niets geprobeerd', zonder.reden, 'geen VAPID-sleutels');
}

// ---------------------------------------------------------------------------
const CLUB = 'BVBL1125';

function nieuweEnv(extra = {}) {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender';
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('ann@club.be',  'Ann',    'Aerts',          0, 'YO',  '${CLUB}');
  `);
  return { DB: db, ENVIRONMENT: 'development', RESEND_API_KEY: 're_test', ...extra };
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'ann@club.be', body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json };
}

console.log('\n6. Voorkeuren: standaardwaarden en wijzigen');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/voorkeuren');
  check('mail staat standaard aan', r.json.mail, true);
  check('push staat standaard uit', r.json.push, false);
  check('herinneringen staan aan', [r.json.herinnerAvond, r.json.herinnerOchtend], [true, true]);
  check('geen toestellen', r.json.toestellen, []);
  check('push niet beschikbaar zonder sleutel', r.json.pushBeschikbaar, false);

  await vraag(env, '/api/voorkeuren', { methode: 'PATCH', body: { herinnerOchtend: false } });
  check('gewijzigd',
    (await vraag(env, '/api/voorkeuren')).json.herinnerOchtend, false);
  check('de rest ongemoeid',
    (await vraag(env, '/api/voorkeuren')).json.herinnerAvond, true);

  check('leeg verzoek geweigerd',
    (await vraag(env, '/api/voorkeuren', { methode: 'PATCH', body: {} })).status, 400);
}

console.log('\n7. Voorkeuren zijn persoonlijk, ook voor een beheerder');
{
  const env = nieuweEnv();
  await vraag(env, '/api/voorkeuren', { methode: 'PATCH', alsWie: 'baas@club.be', body: { mail: false } });

  check('de beheerder wijzigde zijn eigen voorkeur',
    (await vraag(env, '/api/voorkeuren', { alsWie: 'baas@club.be' })).json.mail, false);
  check('die van de YO staat nog aan',
    (await vraag(env, '/api/voorkeuren', { alsWie: 'ann@club.be' })).json.mail, true);
}

console.log('\n8. Abonneren');
{
  const env = nieuweEnv({ VAPID_PUBLIEK: 'BPubliek', VAPID_PRIVE: 'priv' });
  const abo = { endpoint: 'https://fcm.googleapis.com/x/1', p256dh: 'aaa', auth: 'bbb', toestel: 'iPhone' };

  check('inschrijven lukt',
    (await vraag(env, '/api/push/abonneer', { methode: 'POST', body: abo })).status, 200);

  const na = await vraag(env, '/api/voorkeuren');
  check('push staat nu aan', na.json.push, true);
  check('toestel opgeslagen', na.json.toestellen.map((t) => t.toestel), ['iPhone']);
  check('publieke sleutel meegegeven', na.json.vapidPubliek, 'BPubliek');

  // Twee keer hetzelfde endpoint mag geen dubbel opleveren.
  await vraag(env, '/api/push/abonneer', { methode: 'POST', body: { ...abo, toestel: 'iPhone 2' } });
  const opnieuw = await vraag(env, '/api/voorkeuren');
  check('geen dubbel', opnieuw.json.toestellen.length, 1);
  check('wel bijgewerkt', opnieuw.json.toestellen[0].toestel, 'iPhone 2');

  check('http geweigerd',
    (await vraag(env, '/api/push/abonneer',
      { methode: 'POST', body: { ...abo, endpoint: 'http://onveilig.be/x' } })).status, 400);
  check('ontbrekende sleutels geweigerd',
    (await vraag(env, '/api/push/abonneer',
      { methode: 'POST', body: { endpoint: 'https://a.be/x' } })).status, 400);
}

console.log('\n9. Een toestel van iemand anders afmelden kan niet');
{
  const env = nieuweEnv({ VAPID_PUBLIEK: 'B', VAPID_PRIVE: 'p' });
  await vraag(env, '/api/push/abonneer', { methode: 'POST', alsWie: 'baas@club.be',
    body: { endpoint: 'https://fcm.googleapis.com/x/baas', p256dh: 'a', auth: 'b', toestel: 'laptop' } });

  const id = (await vraag(env, '/api/voorkeuren', { alsWie: 'baas@club.be' })).json.toestellen[0].id;

  const poging = await vraag(env, `/api/push/abonneer?id=${id}`, { methode: 'DELETE', alsWie: 'ann@club.be' });
  check('niets verwijderd', poging.json.verwijderd, 0);
  check('het toestel staat er nog',
    (await vraag(env, '/api/voorkeuren', { alsWie: 'baas@club.be' })).json.toestellen.length, 1);

  const eigen = await vraag(env, `/api/push/abonneer?id=${id}`, { methode: 'DELETE', alsWie: 'baas@club.be' });
  check('de eigenaar mag het wel', eigen.json.verwijderd, 1);
}

console.log('\n10. Het verzendkanaal volgt de voorkeuren');
{
  const env = nieuweEnv({ VAPID_PUBLIEK: 'B', VAPID_PRIVE: 'p' });
  const verzonden = [];
  globalThis.fetch = async (url) => {
    verzonden.push(String(url));
    return { ok: true, status: 201, json: async () => ({}) };
  };

  const bericht = { onderwerp: 'Test', tekst: 'Inhoud' };

  // Enkel mail
  await verwittig(env, 'ann@club.be', bericht);
  check('mail verstuurd', verzonden.some((u) => u.includes('resend.com')), true);

  // Mail uit: dan mag er niets gaan
  verzonden.length = 0;
  env.DB.exec("UPDATE users SET kanaal_mail = 0 WHERE email = 'ann@club.be'");
  const stil = await verwittig(env, 'ann@club.be', bericht);
  check('geen enkel bericht', verzonden.length, 0);
  check('en dat wordt gemeld', [stil.mail, stil.push], [false, 0]);

  // Inactieve gebruiker krijgt niets
  env.DB.exec("UPDATE users SET kanaal_mail = 1, actief = 0 WHERE email = 'ann@club.be'");
  verzonden.length = 0;
  const inactief = await verwittig(env, 'ann@club.be', bericht);
  check('inactief betekent niets versturen', verzonden.length, 0);
  check('met reden', inactief.reden, 'niet actief');
}

console.log('\n11. Verlopen abonnementen worden opgeruimd bij het versturen');
{
  const env = nieuweEnv({ VAPID_PUBLIEK: 'B', VAPID_PRIVE: 'p' });
  const abo = await nepAbonnement();
  const sleutels = await maakVapidSleutels();
  env.VAPID_PUBLIEK = sleutels.publiek;
  env.VAPID_PRIVE = sleutels.prive;

  env.DB.exec(`
    UPDATE users SET kanaal_push = 1, kanaal_mail = 0 WHERE email = 'ann@club.be';
    INSERT INTO push_abonnementen (user_email, endpoint, p256dh, auth, toestel)
      VALUES ('ann@club.be', '${abo.endpoint}', '${abo.p256dh}', '${abo.auth}', 'oud toestel');
  `);

  globalThis.fetch = async () => ({ ok: false, status: 410 });
  const r = await verwittig(env, 'ann@club.be', { onderwerp: 'X', tekst: 'Y' });

  check('als verlopen geteld', r.pushVerlopen, 1);
  check('rij verwijderd',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM push_abonnementen').first()).n, 0);
}

console.log('\n12. Het testbericht negeert de voorkeuren');
{
  const env = nieuweEnv();
  env.DB.exec("UPDATE users SET kanaal_mail = 0 WHERE email = 'ann@club.be'");

  const verzonden = [];
  globalThis.fetch = async (url) => { verzonden.push(String(url)); return { ok: true, json: async () => ({}) }; };

  const r = await vraag(env, '/api/voorkeuren/test', { methode: 'POST' });
  check('toch verstuurd', r.json.mail, true);
  check('want wie op testen drukt wil weten of het kanaal werkt',
    verzonden.some((u) => u.includes('resend.com')), true);
}

console.log('\n13. Iedereen mag bij zijn eigen voorkeuren');
{
  const env = nieuweEnv();
  check('een gewone YO ook', (await vraag(env, '/api/voorkeuren', { alsWie: 'ann@club.be' })).status, 200);
  check('zonder aanmelding niet',
    (await vraag(env, '/api/voorkeuren', { alsWie: null })).status, 401);
}

console.log('\n14. Tabbladen verbergen als voorkeur');
{
  const env = nieuweEnv();
  // Het logboek staat standaard uit: een controle-instrument dat je zelden
  // opent, hoort geen vaste plaats in de balk te krijgen.
  check('logboek en aandachtspagina standaard verborgen',
    (await vraag(env, '/api/voorkeuren', { alsWie: 'baas@club.be' })).json.verborgenTabs,
    ['log', 'aandacht']);

  await vraag(env, '/api/voorkeuren',
    { methode: 'PATCH', alsWie: 'baas@club.be', body: { verborgenTabs: [] } });
  check('en weer aan te zetten',
    (await vraag(env, '/api/voorkeuren', { alsWie: 'baas@club.be' })).json.verborgenTabs, []);

  await vraag(env, '/api/voorkeuren',
    { methode: 'PATCH', alsWie: 'baas@club.be', body: { verborgenTabs: ['club'] } });
  check('een ander tabblad verbergen',
    (await vraag(env, '/api/voorkeuren', { alsWie: 'baas@club.be' })).json.verborgenTabs, ['club']);

  // Onbekende sleutels worden genegeerd: dit is een weergavevoorkeur, geen
  // plek om willekeurige tekst in de databank te zetten.
  await vraag(env, '/api/voorkeuren',
    { methode: 'PATCH', alsWie: 'baas@club.be', body: { verborgenTabs: ['log', 'onzin'] } });
  check('enkel gekende tabbladen',
    (await vraag(env, '/api/voorkeuren', { alsWie: 'baas@club.be' })).json.verborgenTabs, ['log']);

  check('per gebruiker apart: die ander staat nog op de standaard',
    (await vraag(env, '/api/voorkeuren', { alsWie: 'ann@club.be' })).json.verborgenTabs,
    ['log', 'aandacht']);
}

console.log('\n15. Uitleg over meldingen in de mail');
{
  const env = nieuweEnv();
  const verzonden = [];
  globalThis.fetch = async (url, opties) => {
    verzonden.push(JSON.parse(opties.body));
    return { ok: true, json: async () => ({}) };
  };

  await verwittig(env, 'ann@club.be', { onderwerp: 'Test', tekst: 'Inhoud' });
  check('uitleg meegestuurd', /Mijn voorkeuren/.test(verzonden[0].text), true);
  check('met de iPhone-stap', /beginscherm/.test(verzonden[0].text), true);
  check('en waarom dat nodig is', /regel van Apple/.test(verzonden[0].text), true);
  check('de eigenlijke inhoud staat er nog', /Inhoud/.test(verzonden[0].text), true);
}

console.log('\n16. Wie meldingen al aanheeft, krijgt de uitleg niet');
{
  const env = nieuweEnv();
  env.DB.exec("UPDATE users SET kanaal_push = 1 WHERE email = 'ann@club.be'");

  const verzonden = [];
  globalThis.fetch = async (url, opties) => {
    verzonden.push(JSON.parse(opties.body));
    return { ok: true, json: async () => ({}) };
  };

  await verwittig(env, 'ann@club.be', { onderwerp: 'Test', tekst: 'Inhoud' });
  const mail = verzonden.find((m) => m.to === 'ann@club.be');
  check('geen uitleg', /beginscherm/.test(mail.text), false);
}

console.log('\n17. Wie een toestel heeft maar het kanaal uitzette, ook niet');
{
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO push_abonnementen (user_email, endpoint, p256dh, auth)
      VALUES ('ann@club.be','https://fcm.googleapis.com/x/9','a','b');
  `);

  const verzonden = [];
  globalThis.fetch = async (url, opties) => {
    verzonden.push(JSON.parse(opties.body));
    return { ok: true, json: async () => ({}) };
  };

  await verwittig(env, 'ann@club.be', { onderwerp: 'Test', tekst: 'Inhoud' });
  check('die weet hoe het werkt', /beginscherm/.test(verzonden[0].text), false);
}

console.log(f === 0 ? '\n=== ALLE PUSHTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
