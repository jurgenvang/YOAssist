/**
 * Tests voor de externe API (V24) en de persoonlijke agendafeed (V25).
 *
 * Beide zijn alleen-lezen en gebruiken een andere beveiliging dan de rest van
 * de app: de API een sleutel in de header, de agenda een sleutel in de URL
 * zelf. Dat verschil staat centraal in deze tests.
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
const SLEUTEL = 'test-sleutel-1234';

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('ann@club.be',  'Ann',    'Aerts',          0, 'YO',  '${CLUB}'),
      ('bert@club.be', 'Bert',   'Bosmans',        0, 'YO',  '${CLUB}');
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, locatie, cat_code, off_aantal, scope, scope_reden, hash)
    VALUES ('M1','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast','${morgen()}','14:00',
            'Sporthal Noord','G12',0,1,'auto','h');
  `);
  return { DB: db, ENVIRONMENT: 'development', EXTERN_API_SLEUTEL: SLEUTEL };
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'baas@club.be', body = null,
                                  header = null } = {}) {
  const opties = { method: methode, headers: {} };
  if (header) opties.headers.Authorization = header;
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers['Content-Type'] = 'application/json'; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  const tekst = json ? null : await res.clone().text();
  return { status: res.status, json, tekst, headers: res.headers };
}

const wijs = (env, matchGuid, email) =>
  vraag(env, '/api/admin/aanduiding', { methode: 'POST', body: { matchGuid, email } });

console.log('\n1. De externe API vraagt de juiste sleutel');
{
  const env = nieuweEnv();
  await wijs(env, 'M1', 'ann@club.be');

  const zonder = await vraag(env, '/api/extern/aanduidingen');
  check('zonder sleutel geweigerd', zonder.status, 401);

  const fout = await vraag(env, '/api/extern/aanduidingen', { header: 'Bearer verkeerd' });
  check('verkeerde sleutel geweigerd', fout.status, 401);

  const goed = await vraag(env, '/api/extern/aanduidingen', { header: `Bearer ${SLEUTEL}` });
  check('juiste sleutel werkt', goed.status, 200);
  check('geen Access nodig: DEV_EMAIL wordt genegeerd', goed.json.aantal, 1);
}

console.log('\n2. Standaard initialen, geen volledige namen');
{
  const env = nieuweEnv();
  await wijs(env, 'M1', 'ann@club.be');

  const r = await vraag(env, '/api/extern/aanduidingen', { header: `Bearer ${SLEUTEL}` });
  check('initiaal, geen volledige naam', r.json.wedstrijden[0].officials, ['A.A.']);
  check('geen e-mailadres in het antwoord',
    JSON.stringify(r.json).includes('ann@club.be'), false);
}

console.log('\n3. Volledige namen als de beheerder dat instelt');
{
  const env = nieuweEnv();
  await wijs(env, 'M1', 'ann@club.be');

  const zet = await vraag(env, '/api/admin/extern-namen',
    { methode: 'POST', body: { waarde: 'volledig' } });
  check('bewaard', zet.json.waarde, 'volledig');

  const r = await vraag(env, '/api/extern/aanduidingen', { header: `Bearer ${SLEUTEL}` });
  check('nu de volledige naam', r.json.wedstrijden[0].officials, ['Ann Aerts']);

  check('een YO mag dit niet instellen', (await vraag(env, '/api/admin/extern-namen',
    { methode: 'POST', alsWie: 'ann@club.be', body: { waarde: 'volledig' } })).status, 403);
}

console.log('\n4. De agendasleutel wordt automatisch aangemaakt');
{
  const env = nieuweEnv();
  const eerste = await vraag(env, '/api/voorkeuren/agenda-sleutel',
    { methode: 'POST', alsWie: 'ann@club.be' });
  check('een sleutel gekregen', eerste.json.sleutel.length > 10, true);

  const tweede = await vraag(env, '/api/voorkeuren/agenda-sleutel',
    { methode: 'POST', alsWie: 'ann@club.be' });
  check('dezelfde sleutel bij een tweede aanvraag', tweede.json.sleutel, eerste.json.sleutel);
}

console.log('\n5. De agendafeed toont enkel bevestigde aanduidingen');
{
  const env = nieuweEnv();
  const sleutel = (await vraag(env, '/api/voorkeuren/agenda-sleutel',
    { methode: 'POST', alsWie: 'ann@club.be' })).json.sleutel;

  const leeg = await vraag(env, `/api/kalender/${sleutel}.ics`);
  check('nog niets aangeduid: geen VEVENT', leeg.tekst.includes('BEGIN:VEVENT'), false);
  check('wel een geldige kalender', leeg.tekst.includes('BEGIN:VCALENDAR'), true);

  await wijs(env, 'M1', 'ann@club.be');
  const gevuld = await vraag(env, `/api/kalender/${sleutel}.ics`);
  check('nu wel een afspraak', gevuld.tekst.includes('BEGIN:VEVENT'), true);
  check('met de locatie erin', gevuld.tekst.includes('Sporthal Noord'), true);
  check('als bevestigd', gevuld.tekst.includes('STATUS:CONFIRMED'), true);
  check('juiste content-type', gevuld.headers.get('content-type').includes('text/calendar'), true);
}

console.log('\n6. Vrijgeven haalt de afspraak eruit');
{
  const env = nieuweEnv();
  const sleutel = (await vraag(env, '/api/voorkeuren/agenda-sleutel',
    { methode: 'POST', alsWie: 'ann@club.be' })).json.sleutel;

  await wijs(env, 'M1', 'ann@club.be');
  check('staat erin', (await vraag(env, `/api/kalender/${sleutel}.ics`))
    .tekst.includes('BEGIN:VEVENT'), true);

  await vraag(env, '/api/admin/aanduiding?matchGuid=M1&email=ann@club.be', { methode: 'DELETE' });
  check('is er weer uit, meteen bij de volgende ophaling',
    (await vraag(env, `/api/kalender/${sleutel}.ics`)).tekst.includes('BEGIN:VEVENT'), false);
}

console.log('\n7. Enkel de eigen wedstrijden, niet die van een collega');
{
  const env = nieuweEnv();
  const annSleutel = (await vraag(env, '/api/voorkeuren/agenda-sleutel',
    { methode: 'POST', alsWie: 'ann@club.be' })).json.sleutel;

  await wijs(env, 'M1', 'bert@club.be');
  const feed = await vraag(env, `/api/kalender/${annSleutel}.ics`);
  check('Ann ziet Berts wedstrijd niet', feed.tekst.includes('BEGIN:VEVENT'), false);
}

console.log('\n8. Vernieuwen maakt de oude link ongeldig');
{
  const env = nieuweEnv();
  const oud = (await vraag(env, '/api/voorkeuren/agenda-sleutel',
    { methode: 'POST', alsWie: 'ann@club.be' })).json.sleutel;

  const nieuw = await vraag(env, '/api/voorkeuren/agenda-sleutel/vernieuw',
    { methode: 'POST', alsWie: 'ann@club.be' });
  check('een andere sleutel', nieuw.json.sleutel === oud, false);

  const oudeLink = await vraag(env, `/api/kalender/${oud}.ics`);
  check('de oude link werkt niet meer', oudeLink.status, 404);

  const nieuweLink = await vraag(env, `/api/kalender/${nieuw.json.sleutel}.ics`);
  check('de nieuwe wel', nieuweLink.status, 200);
}

console.log('\n9. Een onbekende sleutel geeft een nette fout, geen lijst');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/kalender/onzin-die-niet-bestaat.ics');
  check('404 in plaats van een lege agenda', r.status, 404);
}

console.log(f === 0 ? '\n=== ALLE EXTERNE-TESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
