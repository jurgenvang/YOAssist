/**
 * Tests voor ploegverantwoordelijken en coaches (V34): de lijsten beheren met
 * een ingevuld sjabloon, en hen verwittigen bij te weinig scheidsrechters.
 *
 * Datums rekenen vanaf de eerstvolgende woensdag: een vaste datum zou ooit
 * voorbij zijn.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { leesCsv } from '../src/lib/csv.js';
import { planImport, sjabloonRijen, tekortKomendWeekend, verwittigPloegen } from '../src/lib/ploegcontacten.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

const vandaagUtc = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const WOENSDAG = new Date(vandaagUtc.getTime() + ((((3 - vandaagUtc.getUTCDay() + 7) % 7) || 7) * 86400000));
const isoDag = (n) => new Date(WOENSDAG.getTime() + n * 86400000).toISOString().slice(0, 10);
const ZA = isoDag(3);
const ZO = isoDag(4);
// Woensdag 20 uur Brussel = 18 uur UTC in de zomer, 19 uur in de winter.
const WO_AVOND = new Date(`${isoDag(0)}T18:30:00Z`);

const CLUB = 'BVBL1125';
const J16 = `${CLUB}J16  1`;
const J18 = `${CLUB}J18  1`;
const G12 = `${CLUB}G12  1`;

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender';
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'AB InBev Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code, volgen) VALUES
      ('${J16}', '${CLUB}', 'Bears J16 A', 'J16', 1),
      ('${J18}', '${CLUB}', 'Bears J18 A', 'J18', 1),
      ('${G12}', '${CLUB}', 'Bears G12 A', 'G12', 1),
      ('${CLUB}HSE  1', '${CLUB}', 'Bears HSE A', 'HSE', 0);
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('plus@club.be', 'Bert',   'Bosmans',        0, 'YO+', '${CLUB}'),
      ('yo@club.be',   'Ann',    'Aerts',          0, 'YO',  '${CLUB}');
  `);
  return { DB: db, ENVIRONMENT: 'development', RESEND_API_KEY: 're_test' };
}

function wed(env, guid, team, datum, uur, { cat = 'J16', off = 0, bond = null, forfait = null,
  bevestigd = 0, scope = 0, officials = [] } = {}) {
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam, datum, uur, locatie,
                         cat_code, off_namen, off_aantal, bond_officials, forfait, refs_bevestigd, scope, hash)
    VALUES ('${guid}', '2627', '${CLUB}', '${team}', 'Bears ${cat} A', 'Gast', '${datum}', '${uur}', 'Sporthal',
            '${cat}', '[]', ${off}, ${bond ?? 'NULL'}, ${forfait ? `'${forfait}'` : 'NULL'}, ${bevestigd}, ${scope}, 'h${guid}')`);
  for (const e of officials) {
    env.DB.exec(`INSERT INTO assignments (match_guid, user_email, toegewezen_door) VALUES ('${guid}', '${e}', 'baas@club.be')`);
  }
}

function contact(env, tabel, team, voornaam, email) {
  env.DB.exec(`INSERT INTO ${tabel} (team_guid, voornaam, achternaam, email) VALUES ('${team}', '${voornaam}', 'X', '${email}')`);
}

function vangMails() {
  const mails = [];
  globalThis.fetch = async (url, opties) => {
    mails.push(JSON.parse(opties.body));
    return { ok: true, json: async () => ({}) };
  };
  return mails;
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'baas@club.be', body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  const tekst = await res.text();
  let json = null;
  try { json = JSON.parse(tekst); } catch { /* CSV */ }
  return { status: res.status, json, tekst };
}

const TEAMS = [{ guid: 'T1', naam: 'Bears J16 A' }, { guid: 'T2', naam: 'Bears J18 A' }, { guid: 'T3', naam: 'Bears G12 A' }];
const csv = (...regels) => leesCsv(['voornaam,naam,e-mail,team', ...regels].join('\n')).rijen;

// ===========================================================================
console.log('\n1. Het sjabloon: elke ploeg, met wie er al op staat');
{
  const per = new Map([['T1', [{ voornaam: 'Jan', achternaam: 'Peeters', email: 'jan@x.be' }]]]);
  const rijen = sjabloonRijen(TEAMS, per);
  check('drie ploegen, drie regels', rijen.length, 3);
  check('ingevulde ploeg', rijen[0], { voornaam: 'Jan', naam: 'Peeters', 'e-mail': 'jan@x.be', team: 'Bears J16 A' });
  check('lege ploeg: enkel de naam', rijen[1], { voornaam: '', naam: '', 'e-mail': '', team: 'Bears J18 A' });
}

console.log('\n2. Inlezen: vervangt per ploeg in het bestand');
{
  const per = new Map([
    ['T1', [{ voornaam: 'Jan', achternaam: 'Peeters', email: 'jan@x.be' }, { voornaam: 'An', achternaam: 'Oud', email: 'an@x.be' }]],
    ['T3', [{ voornaam: 'Piet', achternaam: 'Blijft', email: 'piet@x.be' }]],
  ]);
  const p = planImport(TEAMS, per, csv(
    'Jan,Peeters,JAN@x.be,bears j16 a',       // blijft (hoofdletters maken niet uit)
    'Mia,Nieuw,mia@x.be,Bears J16 A',         // erbij
    'Tom,Twee,tom@x.be,Bears J18 A',          // erbij bij een lege ploeg
  ));
  check('geen fouten', p.fouten, []);
  check('twee ploegen veranderen', p.wijzigingen.map((w) => w.team), ['Bears J16 A', 'Bears J18 A']);
  const j16 = p.wijzigingen[0];
  check('erbij', j16.nieuw.map((x) => x.email), ['mia@x.be']);
  check('eruit: wie niet meer in het bestand staat', j16.weg.map((x) => x.email), ['an@x.be']);
  check('niet in het bestand: G12 blijft ongemoeid', p.wijzigingen.some((w) => w.guid === 'T3'), false);
}

console.log('\n3. Inlezen: een regel met enkel de ploeg maakt ze leeg');
{
  const per = new Map([['T1', [{ voornaam: 'Jan', achternaam: 'P', email: 'jan@x.be' }]]]);
  const p = planImport(TEAMS, per, csv(',,,Bears J16 A'));
  check('ploeg wordt leeg', [p.wijzigingen[0]?.team, p.wijzigingen[0]?.weg.length, p.wijzigingen[0]?.personen.length],
    ['Bears J16 A', 1, 0]);
}

console.log('\n4. Inlezen: een foute regel laat de hele ploeg ongemoeid');
{
  const per = new Map([['T1', [{ voornaam: 'Jan', achternaam: 'P', email: 'jan@x.be' }]]]);
  const p = planImport(TEAMS, per, csv(
    'Mia,N,mia-zonder-at,Bears J16 A',   // tikfout: Jan mag er niet stil uit
    ',N,lies@x.be,Bears J18 A',          // geen voornaam
    'Kim,N,kim@x.be,Onbekende Ploeg',
    'Rik,N,rik@x.be,',
    'Tom,N,tom@x.be,Bears G12 A',
    'Tom,N,TOM@x.be,Bears G12 A',        // dubbel
  ));
  check('fouten', p.fouten.map((x) => x.reden), [
    'ongeldig e-mailadres', 'voornaam ontbreekt', "ploeg 'Onbekende Ploeg' niet gevonden bij de gevolgde ploegen",
    'geen ploeg ingevuld', 'staat twee keer bij dezelfde ploeg']);
  check('ploegen met een fout blijven ongemoeid', p.overgeslagen.map((o) => o.team), ['Bears J16 A', 'Bears J18 A', 'Bears G12 A']);
  check('niets door te voeren', p.wijzigingen, []);
}

console.log('\n5. Inlezen: dubbele ploegnaam vraagt de GUID, naam aanpassen telt als wijziging');
{
  const teams = [...TEAMS, { guid: 'T4', naam: 'Bears J16 A' }];
  const p = planImport(teams, new Map(), csv('Jan,P,jan@x.be,Bears J16 A', 'Jan,P,jan@x.be,T4'));
  check('naam dubbelzinnig', p.fouten[0]?.reden, "ploeg 'Bears J16 A' bestaat twee keer: gebruik de GUID");
  check('op GUID lukt het', p.wijzigingen.map((w) => w.guid), ['T4']);

  const per = new Map([['T1', [{ voornaam: 'Jan', achternaam: 'P', email: 'jan@x.be' }]]]);
  const zelfde = planImport(TEAMS, per, csv('Jan,P,jan@x.be,Bears J16 A'));
  check('niets veranderd', [zelfde.wijzigingen.length, zelfde.ongewijzigd], [0, 1]);
  const hernoemd = planImport(TEAMS, per, csv('Jan,Peeters,jan@x.be,Bears J16 A'));
  check('andere naam: wordt bijgewerkt', hernoemd.wijzigingen[0]?.hernoemd.map((x) => x.achternaam), ['Peeters']);
}

console.log('\n6. De routes: lijst, sjabloon, droogloop, doorvoeren');
{
  const env = nieuweEnv();
  contact(env, 'ploeg_pv', J16, 'Jan', 'jan@x.be');

  const lijst = await vraag(env, '/api/admin/ploegcontacten?soort=pv');
  check('enkel gevolgde ploegen', lijst.json.teams.map((t) => t.naam), ['Bears G12 A', 'Bears J16 A', 'Bears J18 A']);
  check('met wie erop staat', lijst.json.teams[1].personen.map((p) => p.email), ['jan@x.be']);

  const sj = await vraag(env, '/api/admin/ploegcontacten/sjabloon?soort=pv');
  check('sjabloon: kop', sj.tekst.split('\n')[0], 'voornaam,naam,e-mail,team');
  check('sjabloon: ingevuld', sj.tekst.includes('Jan,X,jan@x.be,Bears J16 A'), true);
  check('sjabloon: lege ploeg erbij', sj.tekst.includes(',,,Bears J18 A'), true);

  const bestand = 'voornaam;naam;e-mail;team\nMia;N;mia@x.be;Bears J18 A\n';   // Belgische Excel: puntkomma's
  const droog = await vraag(env, '/api/admin/ploegcontacten/import', { methode: 'POST', body: { soort: 'pv', csv: bestand } });
  check('droogloop toont de wijziging', droog.json.wijzigingen.map((w) => w.team), ['Bears J18 A']);
  check('droogloop schrijft niets', (await env.DB.prepare('SELECT COUNT(*) AS n FROM ploeg_pv').first()).n, 1);

  const echt = await vraag(env, '/api/admin/ploegcontacten/import',
    { methode: 'POST', body: { soort: 'pv', csv: bestand, uitvoeren: true } });
  check('doorgevoerd', echt.json.uitgevoerd, true);
  const rijen = (await env.DB.prepare('SELECT email FROM ploeg_pv ORDER BY email').all()).results.map((r) => r.email);
  check('Jan blijft (J16 stond niet in het bestand), Mia erbij', rijen, ['jan@x.be', 'mia@x.be']);
  check('niet in de lijst coaches', (await env.DB.prepare('SELECT COUNT(*) AS n FROM ploeg_coaches').first()).n, 0);
  check('gelogd', (await env.DB.prepare("SELECT COUNT(*) AS n FROM logboek WHERE soort = 'ploegcontacten'").first()).n, 1);

  check('onbekende soort', (await vraag(env, '/api/admin/ploegcontacten?soort=users')).status, 400);
  check('kolom ontbreekt', (await vraag(env, '/api/admin/ploegcontacten/import',
    { methode: 'POST', body: { soort: 'coach', csv: 'voornaam,naam\nA,B' } })).status, 400);
  check('YO+ mag niet', (await vraag(env, '/api/admin/ploegcontacten?soort=pv', { alsWie: 'plus@club.be' })).status, 403);
}

console.log('\n7. Welke wedstrijden hebben te weinig scheidsrechters');
{
  const env = nieuweEnv();
  wed(env, 'NUL', J16, ZA, '10:00');                                         // niemand: 2 nodig
  wed(env, 'BOND1_CLUB1', J16, ZA, '12:00', { off: 1, officials: ['plus@club.be'] });   // 1 + 1: in orde
  wed(env, 'BOND1', J18, ZA, '14:00', { off: 1 });                           // 1 nodig
  wed(env, 'LIJST2', J18, ZO, '10:00', { bond: 2 });                         // woensdaglijst: bond voorziet 2
  wed(env, 'U12_EEN', G12, ZO, '11:00', { cat: 'G12', officials: ['yo@club.be'] });   // U10/U12: club levert 2
  wed(env, 'FORFAIT', J16, ZO, '12:00', { forfait: 'uit' });
  wed(env, 'BEVESTIGD', J16, ZO, '13:00', { bevestigd: 1 });
  wed(env, 'G08', J16, ZO, '14:00', { cat: 'G08' });
  wed(env, 'VOLGEND', J16, isoDag(10), '10:00');                             // volgend weekend

  const r = await tekortKomendWeekend(env.DB, WO_AVOND);
  check('weekend', [r.van, r.tot], [ZA, ZO]);
  check('te kort', r.wedstrijden.map((w) => [w.guid, w.nogNodig]), [['NUL', 2], ['BOND1', 1], ['U12_EEN', 1]]);
}

console.log('\n8. Woensdag: één mail per persoon, met al zijn wedstrijden');
{
  const env = nieuweEnv();
  wed(env, 'NUL', J16, ZA, '10:00');
  wed(env, 'BOND1', J18, ZA, '14:00', { off: 1, cat: 'J18' });
  wed(env, 'G12_OK', G12, ZO, '11:00', { cat: 'G12', officials: ['yo@club.be', 'plus@club.be'] });
  contact(env, 'ploeg_pv', J16, 'Jan', 'jan@x.be');
  contact(env, 'ploeg_coaches', J16, 'Kris', 'kris@x.be');
  contact(env, 'ploeg_coaches', J18, 'Kris', 'kris@x.be');      // coach van twee ploegen
  contact(env, 'ploeg_pv', G12, 'Gert', 'gert@x.be');           // G12 in orde: geen mail
  const mails = vangMails();

  const r = await verwittigPloegen(env, WO_AVOND, 'woensdag');
  check('twee wedstrijden, twee ontvangers', [r.wedstrijden, r.ontvangers, r.mails], [2, 2, 2]);
  check('naar PV en coach, niet naar de G12', mails.map((m) => m.to).sort(), ['jan@x.be', 'kris@x.be']);
  const kris = mails.find((m) => m.to === 'kris@x.be');
  check('coach van twee ploegen: beide in één mail', /Bears J16 A[\s\S]*Bears J18 A/.test(kris.text), true);
  check('aanspreking', kris.text.startsWith('Hallo Kris'), true);
  const jan = mails.find((m) => m.to === 'jan@x.be');
  check('woensdag: geruststellend', /Je hoeft nu niets te doen/.test(jan.text), true);
  check('hoeveel nog nodig', /nog 2 scheidsrechters nodig/.test(jan.text), true);
  check('dag leesbaar', new RegExp(`za ${Number(ZA.slice(8))}/${Number(ZA.slice(5, 7))} 10:00`).test(jan.text), true);
  check('contact: de beheerder', /Jurgen van Geijstelen \(baas@club\.be\)/.test(jan.text), true);
  check('geen YO-gebruikers aangeschreven', mails.some((m) => /@club\.be$/.test(m.to)), false);
  check('gelogd', (await env.DB.prepare("SELECT COUNT(*) AS n FROM logboek WHERE soort = 'ploegbericht'").first()).n, 1);
}

console.log('\n9. Donderdag: enkel wat nog te kort is, met de vraag om mee te zoeken');
{
  const env = nieuweEnv();
  wed(env, 'NUL', J16, ZA, '10:00');
  wed(env, 'OPGELOST', J18, ZA, '14:00', { officials: ['yo@club.be', 'plus@club.be'] });
  contact(env, 'ploeg_pv', J16, 'Jan', 'jan@x.be');
  contact(env, 'ploeg_pv', J18, 'Lies', 'lies@x.be');
  const mails = vangMails();

  const DO_AVOND = new Date(`${isoDag(1)}T18:30:00Z`);
  await verwittigPloegen(env, DO_AVOND, 'donderdag');
  check('enkel de ploeg die nog te kort is', mails.map((m) => m.to), ['jan@x.be']);
  check('donderdag: nog niet gelukt', /nog niet gelukt/.test(mails[0]?.text ?? ''), true);
  check('vraag om in te springen', /Kan iemand van de ploeg inspringen/.test(mails[0]?.text ?? ''), true);
}

console.log('\n10. Niets te kort, of niemand op de lijst: geen mail');
{
  const env = nieuweEnv();
  wed(env, 'NUL', J16, ZA, '10:00');
  const mails = vangMails();
  const r = await verwittigPloegen(env, WO_AVOND, 'woensdag');
  check('te kort, maar geen PV of coach', [r.mails, r.zonderContact.map((w) => w.guid)], [0, ['NUL']]);
  check('geen mail', mails.length, 0);
}

console.log('\n11. De planner: woensdag 20 uur Brussel');
{
  const env = nieuweEnv();
  wed(env, 'NUL', J16, ZA, '10:00');
  contact(env, 'ploeg_pv', J16, 'Jan', 'jan@x.be');
  const mails = vangMails();
  const wachten = [];
  const ctx = { waitUntil: (p) => { wachten.push(p); return p; } };
  // 20 uur Brussel: 18 uur UTC in de zomer, 19 uur in de winter.
  const zomer = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false })
    .format(new Date(`${isoDag(0)}T18:00:00Z`)) === '20';
  await worker.scheduled({ scheduledTime: Date.parse(`${isoDag(0)}T${zomer ? '18' : '19'}:00:00Z`) }, env, ctx);
  await Promise.allSettled(wachten);
  check('PV verwittigd', mails.filter((m) => m.to === 'jan@x.be').length, 1);
}

console.log(f === 0 ? '\n=== ALLE PLOEGCONTACTTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
