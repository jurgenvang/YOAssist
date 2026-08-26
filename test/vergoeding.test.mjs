/**
 * Tests voor de facturatie.
 *
 * De kern zit in de correcties: wat er verandert nadat een maand is afgesloten,
 * mag het bedrag van toen niet meer raken maar moet wel rechtgezet worden in de
 * volgende afsluiting.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { maandBereik, magAfsluiten, bouwRegels, perOfficial, alsBedrag } from '../src/lib/vergoeding.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

console.log('\n1. Maandbereik en afsluitregel');
{
  check('gewone maand', maandBereik('2026-10'), { van: '2026-10-01', tot: '2026-10-31' });
  check('februari', maandBereik('2027-02').tot, '2027-02-28');
  check('schrikkeljaar', maandBereik('2028-02').tot, '2028-02-29');
  check('onzin', maandBereik('oktober'), null);
  check('maand 13', maandBereik('2026-13'), null);

  check('tijdens de maand mag het niet', magAfsluiten('2026-10', '2026-10-31').mag, false);
  check('met uitleg', /nog niet voorbij/.test(magAfsluiten('2026-10', '2026-10-15').reden), true);
  check('de eerste van de volgende maand wel', magAfsluiten('2026-10', '2026-11-01').mag, true);
  check('later ook', magAfsluiten('2026-10', '2027-03-01').mag, true);
}

console.log('\n2. Regels bouwen');
{
  const w = (email, cat, tarief) =>
    ({ matchGuid: `M${Math.random()}`, email, naam: 'Ann Aerts', catCode: cat, catLabel: cat, tariefCent: tarief });

  const regels = bouwRegels([
    w('ann@x.be', 'G12', 1500), w('ann@x.be', 'G12', 1500), w('ann@x.be', 'J16', 2000),
  ]);

  check('per categorie samengevoegd', regels.length, 2);
  const u12 = regels.find((r) => r.catCode === 'G12');
  check('twee wedstrijden geteld', u12.aantal, 2);
  check('bedrag opgeteld', u12.bedragCent, 3000);
}

console.log('\n3. Correcties');
{
  const basis = [{ matchGuid: 'M1', email: 'ann@x.be', naam: 'Ann', catCode: 'G12', catLabel: 'U12', tariefCent: 1500 }];
  const regels = bouwRegels(basis, [
    { email: 'ann@x.be', naam: 'Ann', betreftMaand: '2026-09', catCode: 'G12', catLabel: 'U12', tariefCent: 1500, aantal: -1 },
  ]);

  check('twee regels: werk en correctie', regels.map((r) => r.soort), ['wedstrijd', 'correctie']);
  const correctie = regels.find((r) => r.soort === 'correctie');
  check('negatief aantal', correctie.aantal, -1);
  check('negatief bedrag', correctie.bedragCent, -1500);
  check('met vermelding van de maand', correctie.betreftMaand, '2026-09');

  const officials = perOfficial(regels);
  check('saldo op nul', officials[0].totaalCent, 0);
}

{
  // Een correctie die zichzelf opheft, hoort niet in het overzicht.
  const regels = bouwRegels([], [
    { email: 'a@x.be', naam: 'A', betreftMaand: '2026-09', catCode: 'G12', catLabel: 'U12', tariefCent: 1500, aantal: 1 },
    { email: 'a@x.be', naam: 'A', betreftMaand: '2026-09', catCode: 'G12', catLabel: 'U12', tariefCent: 1500, aantal: -1 },
  ]);
  check('opheffende correcties verdwijnen', regels.length, 0);
}

console.log('\n4. Bedragen opmaken');
{
  check('rond bedrag', alsBedrag(6500), '€ 65,00');
  check('met centen', alsBedrag(1550), '€ 15,50');
  check('nul', alsBedrag(0), '€ 0,00');
  check('negatief', alsBedrag(-1500), '− € 15,00');
}

// ---------------------------------------------------------------------------
const CLUB = 'BVBL1125';
const TEAM = `${CLUB}G12  1`;
const TEAM_J16 = `${CLUB}J16  1`;

// Maanden uit een seizoen dat volledig voorbij is: afsluiten mag pas na de
// laatste dag van de maand, dus toekomstige maanden zouden de test laten falen.
const SEIZOEN = '2526';
const M1 = '2026-03';
const M2 = '2026-04';
const M3 = '2026-05';

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    UPDATE settings SET waarde = '2025' WHERE sleutel = 'seizoen_start_jaar';
    UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender';
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES
      ('${TEAM}', '${CLUB}', 'G12 A', 'G12'),
      ('${TEAM_J16}', '${CLUB}', 'J16 A', 'J16');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('ann@club.be',  'Ann',    'Aerts',          0, 'YO',  '${CLUB}'),
      ('bert@club.be', 'Bert',   'Bosmans',        0, 'YO+', '${CLUB}');
  `);
  return { DB: db, ENVIRONMENT: 'development', RESEND_API_KEY: 're_test' };
}

/** Voegt een gespeelde wedstrijd toe met aanduidingen. */
function wedstrijd(env, guid, datum, team, cat, officials = []) {
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_aantal, scope, hash)
    VALUES ('${guid}','${SEIZOEN}','${CLUB}','${team}','${cat} A','Gast','${datum}','14:00','${cat}',0,1,'h${guid}')`);
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

const stilVersturen = () => { globalThis.fetch = async () => ({ ok: true, json: async () => ({}) }); };

console.log('\n5. Voorbeeld vóór afsluiten');
{
  const env = nieuweEnv();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be', 'bert@club.be']);
  wedstrijd(env, 'A2', `${M1}-12`, TEAM, 'G12', ['ann@club.be']);
  wedstrijd(env, 'A3', `${M1}-19`, TEAM_J16, 'J16', ['bert@club.be']);

  const r = await vraag(env, `/api/admin/facturatie/voorbeeld?maand=${M1}`);
  check('twee officials', r.json.aantalOfficials, 2);

  const ann = r.json.officials.find((o) => o.naam === 'Ann Aerts');
  check('Ann: twee keer U12', ann.regels[0].aantal, 2);
  check('en dat is 30 euro', ann.totaal, '€ 30,00');

  const bert = r.json.officials.find((o) => o.naam === 'Bert Bosmans');
  check('Bert: U12 en U16', bert.regels.map((x) => x.catCode).sort(), ['G12', 'J16']);
  check('samen 35 euro', bert.totaal, '€ 35,00');

  check('totaal', r.json.totaal, '€ 65,00');
  check('kan afgesloten worden', r.json.kanAfsluiten, true);
  check('databank nog leeg',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM afgesloten_maanden').first()).n, 0);
}

console.log('\n6. Afsluiten legt de bedragen vast');
{
  const env = nieuweEnv();
  stilVersturen();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be']);

  const te_vroeg = await vraag(env, '/api/admin/facturatie/afsluiten',
    { methode: 'POST', body: { maand: '2099-01' } });
  check('een toekomstige maand kan niet', te_vroeg.status, 409);

  const r = await vraag(env, '/api/admin/facturatie/afsluiten',
    { methode: 'POST', body: { maand: M1 } });
  check('afgesloten', r.status, 200);
  check('bedrag', r.json.totaal, '€ 15,00');

  check('momentopname bewaard',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM vergoeding_regels').first()).n, 1);
  check('spoor bewaard',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM vergoeding_verwerkt').first()).n, 1);

  const nogmaals = await vraag(env, '/api/admin/facturatie/afsluiten',
    { methode: 'POST', body: { maand: M1 } });
  check('twee keer afsluiten kan niet', nogmaals.status, 409);
}

console.log('\n7. Een vrijgave na de afsluiting wijzigt het bedrag van toen niet');
{
  const env = nieuweEnv();
  stilVersturen();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be']);
  await vraag(env, '/api/admin/facturatie/afsluiten', { methode: 'POST', body: { maand: M1 } });

  // Aanduiding wordt achteraf vrijgegeven.
  env.DB.exec("UPDATE assignments SET status = 'vrijgegeven' WHERE match_guid = 'A1'");

  const staat = await vraag(env, `/api/admin/facturatie/staat?maand=${M1}`);
  check('september blijft op 15 euro', staat.json.totaal, '€ 15,00');

  // Oktober: werk plus de correctie.
  wedstrijd(env, 'B1', `${M2}-03`, TEAM, 'G12', ['ann@club.be']);
  const voorbeeld = await vraag(env, `/api/admin/facturatie/voorbeeld?maand=${M2}`);

  check('één correctie', voorbeeld.json.aantalCorrecties, 1);
  const ann = voorbeeld.json.officials[0];
  check('twee regels: werk en correctie', ann.regels.map((r) => r.soort), ['wedstrijd', 'correctie']);
  check('correctie verwijst naar september',
    ann.regels.find((r) => r.soort === 'correctie').betreftMaand, M1);
  check('en is negatief',
    ann.regels.find((r) => r.soort === 'correctie').bedrag, '− € 15,00');
  check('oktober komt dus op nul uit', ann.totaal, '€ 0,00');
}

console.log('\n8. Een aanduiding die pas na de afsluiting bijkomt');
{
  const env = nieuweEnv();
  stilVersturen();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be']);
  await vraag(env, '/api/admin/facturatie/afsluiten', { methode: 'POST', body: { maand: M1 } });

  // Bert wordt achteraf alsnog toegewezen aan een septemberwedstrijd.
  env.DB.exec(`INSERT INTO assignments (match_guid, user_email, toegewezen_door)
               VALUES ('A1','bert@club.be','baas@club.be')`);

  const voorbeeld = await vraag(env, `/api/admin/facturatie/voorbeeld?maand=${M2}`);
  const bert = voorbeeld.json.officials.find((o) => o.naam === 'Bert Bosmans');
  check('Bert krijgt een positieve correctie', bert.regels[0].soort, 'correctie');
  check('voor de eerste maand', bert.regels[0].betreftMaand, M1);
  check('van 15 euro', bert.totaal, '€ 15,00');
}

console.log('\n9. Dezelfde correctie komt niet twee keer terug');
{
  const env = nieuweEnv();
  stilVersturen();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be']);
  await vraag(env, '/api/admin/facturatie/afsluiten', { methode: 'POST', body: { maand: M1 } });
  env.DB.exec("UPDATE assignments SET status = 'vrijgegeven' WHERE match_guid = 'A1'");

  await vraag(env, '/api/admin/facturatie/afsluiten', { methode: 'POST', body: { maand: M2 } });
  const oktober = await vraag(env, `/api/admin/facturatie/staat?maand=${M2}`);
  check('oktober bevat de correctie', oktober.json.totaal, '− € 15,00');

  const november = await vraag(env, `/api/admin/facturatie/voorbeeld?maand=${M3}`);
  check('november bevat ze niet opnieuw', november.json.aantalCorrecties, 0);
  check('en is dus leeg', november.json.aantalOfficials, 0);
}

console.log('\n10. Verdwenen wedstrijden en ontbrekende tarieven');
{
  const env = nieuweEnv();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be']);
  wedstrijd(env, 'A2', `${M1}-06`, TEAM, 'G12', ['bert@club.be']);
  env.DB.exec("UPDATE matches SET status = 'verdwenen' WHERE guid = 'A2'");

  const r = await vraag(env, `/api/admin/facturatie/voorbeeld?maand=${M1}`);
  check('verdwenen wedstrijd niet meegeteld', r.json.aantalOfficials, 1);
  check('maar wel gemeld', r.json.verdwenen.length, 1);
  check('met naam erbij', r.json.verdwenen[0].naam, 'Bert Bosmans');
}

{
  const env = nieuweEnv();
  env.DB.exec(`INSERT INTO teams (guid, club_guid, naam, cat_code)
               VALUES ('${CLUB}ROL  1','${CLUB}','ROL A','ROL')`);
  wedstrijd(env, 'A1', `${M1}-05`, `${CLUB}ROL  1`, 'ROL', ['ann@club.be']);

  const r = await vraag(env, `/api/admin/facturatie/voorbeeld?maand=${M1}`);
  check('zonder tarief gemeld', r.json.zonderTarief.length, 1);
  check('en afsluiten geblokkeerd', r.json.kanAfsluiten, false);

  const poging = await vraag(env, '/api/admin/facturatie/afsluiten',
    { methode: 'POST', body: { maand: M1 } });
  check('de knop weigert ook', poging.status, 409);
  check('met vermelding van de categorie', /ROL/.test(poging.json.detail), true);
}

console.log('\n11. Mail bij het afsluiten');
{
  const env = nieuweEnv();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be']);
  await vraag(env, '/api/admin/facturatie/ontvangers',
    { methode: 'POST', body: { ontvangers: 'penningmeester@club.be, boekhouding@club.be' } });

  const verzonden = [];
  globalThis.fetch = async (url, opties) => {
    verzonden.push(JSON.parse(opties.body));
    return { ok: true, json: async () => ({}) };
  };

  await vraag(env, '/api/admin/facturatie/afsluiten', { methode: 'POST', body: { maand: M1 } });

  const naarAnn = verzonden.find((m) => m.to === 'ann@club.be');
  check('de official krijgt zijn overzicht', Boolean(naarAnn), true);
  check('met het bedrag erin', /€ 15,00/.test(naarAnn.text), true);

  const ontvangers = verzonden.map((m) => m.to);
  check('verzamelstaat naar beide adressen',
    ontvangers.filter((e) => e.includes('@club.be') && e !== 'ann@club.be').sort(),
    ['boekhouding@club.be', 'penningmeester@club.be']);

  const staat = await vraag(env, `/api/admin/facturatie/staat?maand=${M1}`);
  check('verzending genoteerd', Boolean(staat.json.verstuurdOp), true);
}

console.log('\n12. Ontvangers instellen');
{
  const env = nieuweEnv();
  check('ongeldig adres geweigerd',
    (await vraag(env, '/api/admin/facturatie/ontvangers',
      { methode: 'POST', body: { ontvangers: 'geen adres' } })).status, 400);

  const r = await vraag(env, '/api/admin/facturatie/ontvangers',
    { methode: 'POST', body: { ontvangers: 'a@club.be\nb@club.be; c@club.be' } });
  check('komma, puntkomma en nieuwe regel', r.json.ontvangers.length, 3);
}

console.log('\n13. Het eigen overzicht van een official');
{
  const env = nieuweEnv();
  stilVersturen();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be']);
  wedstrijd(env, 'A2', `${M1}-12`, TEAM_J16, 'J16', ['ann@club.be']);
  await vraag(env, '/api/admin/facturatie/afsluiten', { methode: 'POST', body: { maand: M1 } });

  // Een gespeelde wedstrijd in een nog niet afgesloten maand.
  wedstrijd(env, 'B1', `${M2}-03`, TEAM, 'G12', ['ann@club.be']);

  const r = await vraag(env, '/api/vergoeding', { alsWie: 'ann@club.be' });
  check('twee maanden', r.json.maanden.length, 2);
  check('nieuwste bovenaan', r.json.maanden[0].maand, M2);
  check('oktober nog niet afgesloten', r.json.maanden[0].afgesloten, false);
  check('september wel', r.json.maanden[1].afgesloten, true);
  check('september telt 35 euro', r.json.maanden[1].totaal, '€ 35,00');
  check('seizoenstotaal telt enkel wat vastligt', r.json.seizoenTotaal, '€ 35,00');
  check('oktober toont wel al een bedrag', r.json.maanden[0].totaal, '€ 15,00');
}

console.log('\n14. Een official ziet enkel zijn eigen overzicht');
{
  const env = nieuweEnv();
  stilVersturen();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be', 'bert@club.be']);
  await vraag(env, '/api/admin/facturatie/afsluiten', { methode: 'POST', body: { maand: M1 } });

  const ann = await vraag(env, '/api/vergoeding', { alsWie: 'ann@club.be' });
  check('Ann ziet 15 euro', ann.json.seizoenTotaal, '€ 15,00');

  const bert = await vraag(env, '/api/vergoeding', { alsWie: 'bert@club.be' });
  check('Bert ook, apart', bert.json.seizoenTotaal, '€ 15,00');

  check('een YO mag de verzamelstaat niet zien',
    (await vraag(env, '/api/admin/facturatie', { alsWie: 'ann@club.be' })).status, 403);
  check('en niet afsluiten',
    (await vraag(env, '/api/admin/facturatie/afsluiten',
      { methode: 'POST', alsWie: 'ann@club.be', body: { maand: M2 } })).status, 403);
}

console.log('\n15. Een afgesloten maand blokkeert een reset');
{
  const env = nieuweEnv();
  stilVersturen();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be']);
  await vraag(env, '/api/admin/facturatie/afsluiten', { methode: 'POST', body: { maand: M1 } });

  const r = await vraag(env, '/api/admin/reset', { methode: 'POST', body: { niveau: 'wedstrijden' } });
  check('reset geweigerd', r.status, 409);
  check('wedstrijden staan er nog',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first()).n, 1);
}

console.log('\n16. Overzicht van open en afgesloten maanden');
{
  const env = nieuweEnv();
  stilVersturen();
  wedstrijd(env, 'A1', `${M1}-05`, TEAM, 'G12', ['ann@club.be']);
  wedstrijd(env, 'B1', `${M2}-03`, TEAM, 'G12', ['ann@club.be']);
  await vraag(env, '/api/admin/facturatie/afsluiten', { methode: 'POST', body: { maand: M1 } });

  const r = await vraag(env, '/api/admin/facturatie');
  check('eerste maand afgesloten', r.json.afgesloten.map((a) => a.maand), [M1]);
  check('tweede maand staat open', r.json.open.map((o) => o.maand), [M2]);
  check('en mag afgesloten worden', r.json.open[0].mag, true);
}

console.log(f === 0 ? '\n=== ALLE VERGOEDINGSTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
