/**
 * Tests voor Mijn berichten en de mededelingen.
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
const straks = () => new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender';
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('ann@club.be',  'Ann',    'Aerts',          0, 'YO',  '${CLUB}'),
      ('bert@club.be', 'Bert',   'Bosmans',        0, 'YO',  '${CLUB}');
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_aantal, scope, scope_reden, hash)
    VALUES ('M1','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast','${morgen()}','14:00','G12',0,1,'auto','h');
  `);
  return { DB: db, ENVIRONMENT: 'development', RESEND_API_KEY: 're_test' };
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'baas@club.be', body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json };
}

const stil = () => { globalThis.fetch = async () => ({ ok: true, json: async () => ({}) }); };

console.log('\n1. Een aanduiding komt in Mijn berichten');
{
  const env = nieuweEnv();
  stil();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });

  const r = await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' });
  check('één bericht', r.json.aantal, 1);
  check('als aanduiding', r.json.berichten[0].soort, 'aanduiding');
  check('met de wedstrijd erbij', /G12 A - Gast/.test(r.json.berichten[0].wedstrijd), true);
  check('en het kanaal', r.json.berichten[0].kanalen, ['mail']);

  // Enkel voor de ontvanger, niet voor de rest van de club.
  check('een ander ziet niets',
    (await vraag(env, '/api/berichten', { alsWie: 'bert@club.be' })).json.aantal, 0);
}

console.log('\n2. Mislukte verzending komt er niet in');
{
  const env = nieuweEnv();
  env.DB.exec("UPDATE settings SET waarde = '' WHERE sleutel = 'mail_afzender'");

  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });

  const r = await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' });
  check('geen bericht bewaard', r.json.aantal, 0);
  check('maar de aanduiding staat er wel',
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM assignments WHERE status='toegewezen'").first()).n, 1);
}

console.log('\n3. Een vrijgave ook');
{
  const env = nieuweEnv();
  stil();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });
  await vraag(env, '/api/admin/aanduiding?matchGuid=M1&email=ann@club.be', { methode: 'DELETE' });

  const r = await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' });
  check('twee berichten', r.json.aantal, 2);
  check('nieuwste eerst', r.json.berichten[0].soort, 'vrijgave');
}

console.log('\n4. Een mededeling plaatsen');
{
  const env = nieuweEnv();
  stil();

  const leeg = await vraag(env, '/api/mededeling', { alsWie: 'ann@club.be' });
  check('nog geen mededeling', leeg.json.mededeling, null);

  const droog = await vraag(env, '/api/admin/mededeling',
    { methode: 'POST', body: { tekst: 'Zaterdag alles afgelast.', geldigTot: straks() } });
  check('droogloop toont het aantal', droog.json.aantal, 3);
  check('niet uitgevoerd', droog.json.uitgevoerd, false);
  check('nog steeds niets zichtbaar',
    (await vraag(env, '/api/mededeling', { alsWie: 'ann@club.be' })).json.mededeling, null);

  const uit = await vraag(env, '/api/admin/mededeling', {
    methode: 'POST',
    body: { tekst: 'Zaterdag alles afgelast.', geldigTot: straks(), uitvoeren: true },
  });
  check('geplaatst', uit.json.uitgevoerd, true);
  check('iedereen verwittigd', uit.json.verstuurd, 3);

  const nu = await vraag(env, '/api/mededeling', { alsWie: 'ann@club.be' });
  check('zichtbaar', nu.json.mededeling.tekst, 'Zaterdag alles afgelast.');

  const berichten = await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' });
  check('en staat in Mijn berichten', berichten.json.berichten[0].soort, 'nieuws');
}

console.log('\n5. Wegklikken geldt per persoon');
{
  const env = nieuweEnv();
  stil();
  await vraag(env, '/api/admin/mededeling', {
    methode: 'POST', body: { tekst: 'Iets belangrijks.', geldigTot: straks(), uitvoeren: true },
  });

  const id = (await vraag(env, '/api/mededeling', { alsWie: 'ann@club.be' })).json.mededeling.id;
  await vraag(env, '/api/mededeling/wegklikken',
    { methode: 'POST', alsWie: 'ann@club.be', body: { id } });

  check('weg bij wie klikte',
    (await vraag(env, '/api/mededeling', { alsWie: 'ann@club.be' })).json.mededeling, null);
  check('nog zichtbaar bij een ander',
    (await vraag(env, '/api/mededeling', { alsWie: 'bert@club.be' })).json.mededeling.id, id);
  check('blijft wel in Mijn berichten staan',
    (await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' })).json.berichten[0].soort, 'nieuws');
}

console.log('\n6. Een verlopen mededeling verdwijnt vanzelf');
{
  const env = nieuweEnv();
  stil();
  await vraag(env, '/api/admin/mededeling', {
    methode: 'POST', body: { tekst: 'Tijdelijk.', geldigTot: straks(), uitvoeren: true },
  });

  // De vervaldatum naar het verleden zetten.
  env.DB.exec("UPDATE mededelingen SET geldig_tot = datetime('now', '-1 hour')");

  check('niet meer zichtbaar, zonder wegklikken',
    (await vraag(env, '/api/mededeling', { alsWie: 'ann@club.be' })).json.mededeling, null);
  check('ook niet bij een ander',
    (await vraag(env, '/api/mededeling', { alsWie: 'bert@club.be' })).json.mededeling, null);
}

console.log('\n7. Eén tegelijk: een nieuwe vervangt de vorige');
{
  const env = nieuweEnv();
  stil();
  await vraag(env, '/api/admin/mededeling', {
    methode: 'POST', body: { tekst: 'Eerste.', geldigTot: straks(), uitvoeren: true },
  });
  await vraag(env, '/api/admin/mededeling', {
    methode: 'POST', body: { tekst: 'Tweede.', geldigTot: straks(), uitvoeren: true },
  });

  check('de nieuwste staat er', (await vraag(env, '/api/mededeling',
    { alsWie: 'ann@club.be' })).json.mededeling.tekst, 'Tweede.');

  const berichten = await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' });
  check('allebei bewaard in Mijn berichten',
    berichten.json.berichten.filter((b) => b.soort === 'nieuws').length, 2);
}

console.log('\n8. Intrekken');
{
  const env = nieuweEnv();
  stil();
  await vraag(env, '/api/admin/mededeling', {
    methode: 'POST', body: { tekst: 'Toch niet.', geldigTot: straks(), uitvoeren: true },
  });
  await vraag(env, '/api/admin/mededeling', { methode: 'DELETE' });

  check('meteen weg bij iedereen',
    (await vraag(env, '/api/mededeling', { alsWie: 'ann@club.be' })).json.mededeling, null);
}

console.log('\n9. Validatie');
{
  const env = nieuweEnv();
  const geldig = { tekst: 'Iets.', geldigTot: straks() };

  check('lege tekst', (await vraag(env, '/api/admin/mededeling',
    { methode: 'POST', body: { ...geldig, tekst: '' } })).status, 400);
  check('geen einddatum', (await vraag(env, '/api/admin/mededeling',
    { methode: 'POST', body: { tekst: 'Iets.' } })).status, 400);
  check('einddatum in het verleden', (await vraag(env, '/api/admin/mededeling',
    { methode: 'POST', body: { ...geldig, geldigTot: '2020-01-01T10:00' } })).status, 400);
  check('link zonder http', (await vraag(env, '/api/admin/mededeling',
    { methode: 'POST', body: { ...geldig, link: 'basketbal.be' } })).status, 400);
  check('YO mag geen mededeling zetten', (await vraag(env, '/api/admin/mededeling',
    { methode: 'POST', alsWie: 'ann@club.be', body: geldig })).status, 403);
}

console.log('\n10. Enkel in de app, zonder te versturen');
{
  const env = nieuweEnv();
  const verzonden = [];
  globalThis.fetch = async (url, o) => { verzonden.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; };

  await vraag(env, '/api/admin/mededeling', {
    methode: 'POST',
    body: { tekst: 'Rustig aan.', geldigTot: straks(), kanalen: 'geen', uitvoeren: true },
  });

  check('niets verstuurd', verzonden.length, 0);
  check('maar wel zichtbaar', (await vraag(env, '/api/mededeling',
    { alsWie: 'ann@club.be' })).json.mededeling.tekst, 'Rustig aan.');
  // Zonder verzending is er ook geen bericht: Mijn berichten toont wat je
  // ontving, niet wat er op het scherm stond.
  check('geen bericht bewaard',
    (await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' })).json.aantal, 0);
}

console.log('\n11. Gelezen/ongelezen (V23)');
{
  const env = nieuweEnv();
  stil();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });

  const eerst = await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' });
  check('nieuw bericht is ongelezen', eerst.json.berichten[0].gelezen, false);
  check('en telt mee in de teller', eerst.json.ongelezen, 1);

  const id = eerst.json.berichten[0].id;
  const markeer = await vraag(env, `/api/berichten/gelezen?id=${id}`,
    { methode: 'PATCH', alsWie: 'ann@club.be' });
  check('gemarkeerd', markeer.json.gewijzigd, 1);

  const daarna = await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' });
  check('nu gelezen', daarna.json.berichten[0].gelezen, true);
  check('teller op nul', daarna.json.ongelezen, 0);

  // Nogmaals markeren mag, maar verandert niets (was al gelezen).
  const nogmaals = await vraag(env, `/api/berichten/gelezen?id=${id}`,
    { methode: 'PATCH', alsWie: 'ann@club.be' });
  check('nogmaals markeren doet niets', nogmaals.json.gewijzigd, 0);

  // Iemand anders kan het bericht van Ann niet markeren.
  const vreemd = await vraag(env, `/api/berichten/gelezen?id=${id}`,
    { methode: 'PATCH', alsWie: 'bert@club.be' });
  check('een ander kan het niet markeren', vreemd.json.gewijzigd, 0);
}

console.log('\n12. Alles als gelezen markeren');
{
  const env = nieuweEnv();
  stil();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });
  await vraag(env, '/api/admin/aanduiding?matchGuid=M1&email=ann@club.be', { methode: 'DELETE' });

  const voor = await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' });
  check('twee ongelezen', voor.json.ongelezen, 2);

  const alles = await vraag(env, '/api/berichten/alles-gelezen',
    { methode: 'PATCH', alsWie: 'ann@club.be' });
  check('allebei gewijzigd', alles.json.gewijzigd, 2);

  const na = await vraag(env, '/api/berichten', { alsWie: 'ann@club.be' });
  check('niets meer ongelezen', na.json.ongelezen, 0);

  // Enkel de eigen berichten, niet die van een ander.
  check('bert blijft ongemoeid',
    (await vraag(env, '/api/berichten', { alsWie: 'bert@club.be' })).json.ongelezen, 0);
}

console.log('\n13. Wegvegen');
{
  const env = nieuweEnv();
  stil();
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });

  const id = (await vraag(env, '/api/berichten',
    { alsWie: 'ann@club.be' })).json.berichten[0].id;

  const weg = await vraag(env, `/api/berichten?id=${id}`,
    { methode: 'DELETE', alsWie: 'ann@club.be' });
  check('verwijderd', weg.json.verwijderd, 1);

  check('is echt weg', (await vraag(env, '/api/berichten',
    { alsWie: 'ann@club.be' })).json.aantal, 0);

  // Iemand anders kan het bericht van Ann niet verwijderen. Eerst vrijgeven,
  // want de eerdere aanduiding staat nog steeds — die is nooit ingetrokken,
  // enkel het bericht erover werd weggeveegd.
  await vraag(env, '/api/admin/aanduiding?matchGuid=M1&email=ann@club.be', { methode: 'DELETE' });
  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });
  const id2 = (await vraag(env, '/api/berichten',
    { alsWie: 'ann@club.be' })).json.berichten[0].id;
  const poging = await vraag(env, `/api/berichten?id=${id2}`,
    { methode: 'DELETE', alsWie: 'bert@club.be' });
  check('een ander kan het niet verwijderen', poging.json.verwijderd, 0);
}

console.log('\n14. De losse tellerroute');
{
  const env = nieuweEnv();
  stil();
  check('start op nul', (await vraag(env, '/api/berichten/ongelezen',
    { alsWie: 'ann@club.be' })).json.ongelezen, 0);

  await vraag(env, '/api/admin/aanduiding',
    { methode: 'POST', body: { matchGuid: 'M1', email: 'ann@club.be' } });
  check('telt na een aanduiding', (await vraag(env, '/api/berichten/ongelezen',
    { alsWie: 'ann@club.be' })).json.ongelezen, 1);
}

console.log(f === 0 ? '\n=== ALLE BERICHTENTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
