/**
 * Forfait (V40): wat er gebeurt met eigen aanduidingen, en waar een
 * forfaitwedstrijd overgeslagen wordt.
 *
 * De kern: automatisch vrijgeven enkel als het forfait vóór de wedstrijddag
 * gekend is. Een forfait op de dag zelf of achteraf kan betekenen dat de
 * official al naar de wedstrijd kwam — dat beslist de beheerder.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { verwerkForfaits } from '../src/lib/forfait.js';
import { pasWoensdagregelToe } from '../src/lib/woensdag.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

const CLUB = 'BVBL1125';
const dag = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender';
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES
      ('${CLUB}J16  4', '${CLUB}', 'J16 D', 'J16'),
      ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('ann@club.be',  'Ann',    'Aerts',          0, 'YO+', '${CLUB}'),
      ('bert@club.be', 'Bert',   'Bosmans',        0, 'YO+', '${CLUB}');
  `);
  return { DB: db, ENVIRONMENT: 'development', RESEND_API_KEY: 're_test' };
}

/** Een wedstrijd in de lijst, eventueel met forfait en aanduidingen. */
function wedstrijd(env, guid, datum, { forfait = null, officials = [], cat = 'J16', team = 'J16  4', off = 0 } = {}) {
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_namen, off_aantal, scope, scope_reden, forfait, hash)
    VALUES ('${guid}','2627','${CLUB}','${CLUB}${team}','Bears ${cat}','Vilvoorde','${datum}','09:00',
            '${cat}','[]',${off},1,'woensdag',${forfait ? `'${forfait}'` : 'NULL'},'h${guid}')`);
  for (const email of officials) {
    env.DB.exec(`INSERT INTO assignments (match_guid, user_email, toegewezen_door)
                 VALUES ('${guid}','${email}','baas@club.be')`);
  }
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'baas@club.be', body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json };
}

const status = async (env, guid, email) =>
  (await env.DB.prepare('SELECT status FROM assignments WHERE match_guid = ? AND user_email = ?')
    .bind(guid, email).first())?.status;

function vangMails() {
  const verzonden = [];
  globalThis.fetch = async (url, opties) => { verzonden.push(JSON.parse(opties.body)); return { ok: true, json: async () => ({}) }; };
  return verzonden;
}

console.log('\n1. Forfait vóór de wedstrijddag: automatisch vrijgeven (standaard)');
{
  const env = nieuweEnv();
  const mails = vangMails();
  wedstrijd(env, 'TOEKOMST', dag(10), { forfait: 'uit', officials: ['ann@club.be', 'bert@club.be'] });

  const r = await verwerkForfaits(env, [{ guid: 'TOEKOMST', datum: dag(10) }]);
  check('vrijgegeven', r.vrijgegeven.map((x) => x.guid), ['TOEKOMST']);
  check('Ann vrijgegeven', await status(env, 'TOEKOMST', 'ann@club.be'), 'vrijgegeven');
  check('Bert ook', await status(env, 'TOEKOMST', 'bert@club.be'), 'vrijgegeven');

  const naarAnn = mails.find((m) => m.to === 'ann@club.be');
  check('Ann krijgt bericht', Boolean(naarAnn), true);
  check('met forfait als reden', /forfait/i.test(naarAnn.subject), true);
  check('niet "weer beschikbaar"', /weer als beschikbaar/.test(naarAnn.text), false);

  const naarBaas = mails.find((m) => m.to === 'baas@club.be');
  check('beheerder krijgt overzicht', /Automatisch vrijgegeven/.test(naarBaas.text), true);
  check('met de namen', /Ann Aerts, Bert Bosmans/.test(naarBaas.text), true);

  check('logboek met systeem als wie',
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM logboek WHERE soort = 'vrijgegeven' AND wie = 'systeem'").first()).n, 2);
}

console.log('\n2. Forfait op de dag zelf of achteraf: nooit automatisch');
{
  const env = nieuweEnv();
  const mails = vangMails();
  wedstrijd(env, 'VANDAAG', dag(0), { forfait: 'uit', officials: ['ann@club.be'] });
  wedstrijd(env, 'GISTEREN', dag(-1), { forfait: 'thuis', officials: ['bert@club.be'] });

  const r = await verwerkForfaits(env, [{ guid: 'VANDAAG' }, { guid: 'GISTEREN' }]);
  check('niets vrijgegeven', r.vrijgegeven.length, 0);
  check('beide te bekijken', r.teBekijken.map((x) => x.guid).sort(), ['GISTEREN', 'VANDAAG']);
  check('Ann staat er nog', await status(env, 'VANDAAG', 'ann@club.be'), 'toegewezen');
  check('Bert ook', await status(env, 'GISTEREN', 'bert@club.be'), 'toegewezen');
  check('de officials krijgen niets', mails.filter((m) => m.to !== 'baas@club.be').length, 0);
  check('de beheerder wel, met uitleg',
    /al naar de wedstrijd|ter plaatse/.test(mails.find((m) => m.to === 'baas@club.be').text), true);
}

console.log('\n3. Instelling "enkel melden": ook vooraf niets vrijgeven');
{
  const env = nieuweEnv();
  const mails = vangMails();
  const zet = await vraag(env, '/api/admin/forfait-aanduiding', { methode: 'POST', body: { waarde: 'melden' } });
  check('instelling bewaard', zet.json.waarde, 'melden');
  check('en teruggegeven in de configuratie', (await vraag(env, '/api/admin/mail')).json.forfaitAanduiding, 'melden');

  wedstrijd(env, 'TOEKOMST', dag(10), { forfait: 'uit', officials: ['ann@club.be'] });
  const r = await verwerkForfaits(env, [{ guid: 'TOEKOMST' }]);
  check('niet vrijgegeven', await status(env, 'TOEKOMST', 'ann@club.be'), 'toegewezen');
  check('te bekijken', r.teBekijken.length, 1);
  check('official krijgt niets', mails.some((m) => m.to === 'ann@club.be'), false);

  const terug = await vraag(env, '/api/admin/forfait-aanduiding', { methode: 'POST', body: { waarde: 'onzin' } });
  check('onbekende waarde wordt de standaard', terug.json.waarde, 'vrijgeven');
  check('een official mag dit niet',
    (await vraag(env, '/api/admin/forfait-aanduiding', { methode: 'POST', alsWie: 'ann@club.be', body: { waarde: 'melden' } })).status, 403);
}

console.log('\n4. Geen ruis: zonder aanduiding of in een afgesloten maand');
{
  const env = nieuweEnv();
  const mails = vangMails();
  wedstrijd(env, 'LEEG', dag(10), { forfait: 'uit' });
  const oud = '2026-09-12';
  wedstrijd(env, 'OUD', oud, { forfait: 'uit', officials: ['ann@club.be'] });
  env.DB.exec(`INSERT INTO afgesloten_maanden (maand, seizoen, afgesloten_door, totaal_cent, aantal_officials)
               VALUES ('2026-09', '2627', 'baas@club.be', 0, 0)`);

  const r = await verwerkForfaits(env, [{ guid: 'LEEG' }, { guid: 'OUD' }]);
  check('niets te doen', [r.vrijgegeven.length, r.teBekijken.length], [0, 0]);
  check('geen enkele mail', mails.length, 0);
  check('lege lijst: niets', (await verwerkForfaits(env, [])).vrijgegeven.length, 0);
}

console.log('\n5. Een forfaitwedstrijd wordt overgeslagen');
{
  const env = nieuweEnv();
  vangMails();
  const woensdag = new Date('2026-10-07T12:00:00Z');
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_namen, off_aantal, scope, forfait, hash) VALUES
      ('FF','2627','${CLUB}','${CLUB}J16  4','J16 D','Vilvoorde','2026-10-10','09:00','J16','[]',0,0,'uit','h1'),
      ('GEWOON','2627','${CLUB}','${CLUB}J16  4','J16 D','Aarschot','2026-10-11','09:00','J16','[]',0,0,NULL,'h2')`);
  const r = await pasWoensdagregelToe(env.DB, woensdag);
  check('woensdagregel neemt enkel de gewone', r.wedstrijden.map((w) => w.guid), ['GEWOON']);

  // Beschikbaarheid en aanduiden.
  wedstrijd(env, 'LIJST', dag(5), { forfait: 'uit' });
  const ja = await vraag(env, '/api/availability', { methode: 'POST', alsWie: 'ann@club.be', body: { matchGuid: 'LIJST', status: 'ja' } });
  check('beschikbaar zetten kan niet', ja.status, 409);
  const wissen = await vraag(env, '/api/availability', { methode: 'POST', alsWie: 'ann@club.be', body: { matchGuid: 'LIJST', status: null } });
  check('wissen mag wel', wissen.status, 200);
  const toe = await vraag(env, '/api/admin/aanduiding', { methode: 'POST', body: { matchGuid: 'LIJST', email: 'ann@club.be' } });
  check('aanduiden kan niet', [toe.status, toe.json.error], [409, 'Forfait']);

  // De officiallijst en het cluboverzicht.
  const lijst = await vraag(env, '/api/matches', { alsWie: 'ann@club.be' });
  check('official ziet het forfait', lijst.json.matches.find((m) => m.guid === 'LIJST').forfait, 'uit');

  const voor = (await vraag(env, '/api/admin/overzicht')).json;
  wedstrijd(env, 'MELDEN', dag(1), { forfait: 'thuis', officials: ['bert@club.be'] });
  const o = (await vraag(env, '/api/admin/overzicht')).json;
  const kaart = o.wedstrijden.find((w) => w.guid === 'MELDEN');
  check('overzicht: niemand nodig', kaart.nodig, 0);
  check('overzicht: geen probleem', kaart.probleem, false);
  check('overzicht: in het venster', kaart.inVenster, true);
  check('overzicht: de aanduiding blijft zichtbaar', kaart.toegewezen.map((t) => t.email), ['bert@club.be']);
  check('tellers ongewijzigd door een forfait',
    [o.onvolledig, o.zonderBeschikbaren, o.metProbleem],
    [voor.onvolledig, voor.zonderBeschikbaren, voor.metProbleem]);
}

console.log('\n6. In de vergoedingen gemarkeerd, niet weggelaten');
{
  const env = nieuweEnv();
  vangMails();
  wedstrijd(env, 'FFVERG', '2026-09-20', { forfait: 'uit', officials: ['ann@club.be'], cat: 'G12', team: 'G12  1' });
  wedstrijd(env, 'GEWOON', '2026-09-21', { officials: ['ann@club.be'], cat: 'G12', team: 'G12  1' });
  env.DB.exec("UPDATE settings SET waarde = '2026' WHERE sleutel = 'seizoen_start_jaar'");

  const r = await vraag(env, '/api/admin/facturatie/voorbeeld?maand=2026-09');
  const ann = r.json.officials.find((o) => o.email === 'ann@club.be');
  check('beide tellen mee', ann.wedstrijden.length, 2);
  check('forfait gemarkeerd', ann.wedstrijden.find((w) => w.matchGuid === 'FFVERG').forfait, 'uit');
  check('gewone niet', ann.wedstrijden.find((w) => w.matchGuid === 'GEWOON').forfait, null);
}

console.log('\n7. De keuzelijst "Extern lezen" toont wat bewaard is');
{
  const env = nieuweEnv();
  check('standaard initialen', (await vraag(env, '/api/admin/mail')).json.externNamen, 'initialen');
  await vraag(env, '/api/admin/extern-namen', { methode: 'POST', body: { waarde: 'volledig' } });
  check('na bewaren: volledig', (await vraag(env, '/api/admin/mail')).json.externNamen, 'volledig');
}

console.log(f === 0 ? '\n=== ALLE FORFAITTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
