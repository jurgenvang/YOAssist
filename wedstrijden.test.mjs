/**
 * Tests voor het in bulk vrijgeven van aanduidingen en beschikbaarheden.
 *
 * Kernonderscheid: een aanduiding wordt op 'vrijgegeven' gezet en blijft
 * bestaan, een beschikbaarheid wordt gewist omdat die geen tussentoestand kent.
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

/**
 * Wedstrijden in september, oktober en november, elk met twee aanduidingen en
 * drie beschikbaarheden.
 */
function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES
      ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be',  'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('baas2@club.be', 'Fluppe', 'Van Meerbeeck',  1, 'YO+', '${CLUB}'),
      ('ann@club.be',   'Ann',    'Aerts',          0, 'YO',  '${CLUB}'),
      ('bert@club.be',  'Bert',   'Bosmans',        0, 'YO',  '${CLUB}');
  `);

  for (const [guid, datum] of [['SEP', '2026-09-12'], ['OKT', '2026-10-10'], ['NOV', '2026-11-14']]) {
    db.exec(`
      INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                           datum, uur, cat_code, off_aantal, scope, scope_reden, hash)
      VALUES ('${guid}','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast','${datum}','14:00','G12',0,1,'auto','h${guid}');
      INSERT INTO assignments (match_guid, user_email, toegewezen_door) VALUES
        ('${guid}','ann@club.be','baas@club.be'),
        ('${guid}','bert@club.be','baas@club.be');
      INSERT INTO availability (user_email, match_guid, status) VALUES
        ('ann@club.be','${guid}','ja'),
        ('bert@club.be','${guid}','ja'),
        ('baas@club.be','${guid}','nee');
    `);
  }

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

const geefVrij = (env, body, alsWie = 'baas@club.be') =>
  vraag(env, '/api/admin/vrijgeven', { methode: 'POST', alsWie, body });

const tel = async (env, sql) => (await env.DB.prepare(sql).first()).n;

console.log('\n1. Maandoverzicht');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/admin/vrijgeven/maanden');
  check('drie maanden', r.json.maanden.map((m) => m.maand), ['2026-09', '2026-10', '2026-11']);
  check('aanduidingen per maand', r.json.maanden[0].aanduidingen, 2);
  check('beschikbaarheden per maand', r.json.maanden[0].beschikbaarheden, 3);
  check('seizoenlabel', r.json.seizoen, '2026-2027');
}

console.log('\n2. Droogloop verandert niets');
{
  const env = nieuweEnv();
  const r = await geefVrij(env, { wat: 'beide', maand: '2026-10' });

  check('niet uitgevoerd', r.json.uitgevoerd, false);
  check('twee aanduidingen geraakt', r.json.aantalAanduidingen, 2);
  check('drie beschikbaarheden geraakt', r.json.aantalBeschikbaarheden, 3);
  check('twee betrokken officials', r.json.betrokkenOfficials, 2);
  check('met namen in het voorbeeld',
    r.json.aanduidingen.map((a) => a.naam), ['Ann Aerts', 'Bert Bosmans']);

  check('databank ongemoeid: aanduidingen',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE status='toegewezen'"), 6);
  check('databank ongemoeid: beschikbaarheden',
    await tel(env, 'SELECT COUNT(*) AS n FROM availability'), 9);
}

console.log('\n3. Aanduidingen worden vrijgegeven, niet verwijderd');
{
  const env = nieuweEnv();
  await geefVrij(env, { wat: 'aanduidingen', maand: '2026-10', uitvoeren: true });

  check('rijen blijven bestaan', await tel(env, 'SELECT COUNT(*) AS n FROM assignments'), 6);
  check('oktober staat op vrijgegeven',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE match_guid='OKT' AND status='vrijgegeven'"), 2);
  check('september ongemoeid',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE match_guid='SEP' AND status='toegewezen'"), 2);
  check('november ongemoeid',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE match_guid='NOV' AND status='toegewezen'"), 2);
  check('beschikbaarheden niet aangeraakt',
    await tel(env, 'SELECT COUNT(*) AS n FROM availability'), 9);
}

console.log('\n4. Beschikbaarheden worden gewist');
{
  const env = nieuweEnv();
  await geefVrij(env, { wat: 'beschikbaarheden', maand: '2026-10', uitvoeren: true });

  check('oktober gewist',
    await tel(env, "SELECT COUNT(*) AS n FROM availability WHERE match_guid='OKT'"), 0);
  check('de rest blijft', await tel(env, 'SELECT COUNT(*) AS n FROM availability'), 6);
  check('aanduidingen niet aangeraakt',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE status='toegewezen'"), 6);
}

console.log('\n5. Beide tegelijk');
{
  const env = nieuweEnv();
  const r = await geefVrij(env, { wat: 'beide', maand: '2026-09', uitvoeren: true });

  check('uitgevoerd', r.json.uitgevoerd, true);
  check('september: aanduidingen vrijgegeven',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE match_guid='SEP' AND status='vrijgegeven'"), 2);
  check('september: beschikbaarheden weg',
    await tel(env, "SELECT COUNT(*) AS n FROM availability WHERE match_guid='SEP'"), 0);
  check('oktober en november intact',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE status='toegewezen'"), 4);
}

console.log('\n6. Zonder maand: het hele seizoen');
{
  const env = nieuweEnv();
  const r = await geefVrij(env, { wat: 'beide', uitvoeren: true });

  check('alle zes aanduidingen', r.json.aantalAanduidingen, 6);
  check('alle negen beschikbaarheden', r.json.aantalBeschikbaarheden, 9);
  check('omschrijving noemt het seizoen', r.json.periode, 'seizoen 2026-2027');
  check('niets meer toegewezen',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE status='toegewezen'"), 0);
  check('geen beschikbaarheden meer', await tel(env, 'SELECT COUNT(*) AS n FROM availability'), 0);
}

console.log('\n7. Maandgrenzen kloppen');
{
  const env = nieuweEnv();
  // Een wedstrijd op de laatste dag van de maand moet meetellen.
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_aantal, scope, hash)
    VALUES ('LAATST','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast','2026-10-31','14:00','G12',0,1,'hL'),
           ('EERSTE','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast','2026-11-01','14:00','G12',0,1,'hE');
    INSERT INTO assignments (match_guid, user_email, toegewezen_door) VALUES
      ('LAATST','ann@club.be','baas@club.be'),
      ('EERSTE','ann@club.be','baas@club.be');
  `);

  const r = await geefVrij(env, { wat: 'aanduidingen', maand: '2026-10', uitvoeren: true });
  check('31 oktober telt mee', r.json.aantalAanduidingen, 3);
  check('1 november niet',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE match_guid='EERSTE' AND status='toegewezen'"), 1);
  check('bereik tot de laatste dag', r.json.tot, '2026-10-31');
}

console.log('\n8. Februari in een schrikkeljaar');
{
  const env = nieuweEnv();
  const r = await geefVrij(env, { wat: 'aanduidingen', maand: '2028-02' });
  check('29 februari 2028', r.json.tot, '2028-02-29');

  const geen = await geefVrij(env, { wat: 'aanduidingen', maand: '2027-02' });
  check('28 februari 2027', geen.json.tot, '2027-02-28');
}

console.log('\n9. Validatie');
{
  const env = nieuweEnv();
  check('onbekende waarde voor wat', (await geefVrij(env, { wat: 'alles' })).status, 400);
  check('maand in het verkeerde formaat',
    (await geefVrij(env, { wat: 'beide', maand: 'oktober' })).status, 400);
  check('maand 13 bestaat niet',
    (await geefVrij(env, { wat: 'beide', maand: '2026-13' })).status, 400);
  check('YO mag dit niet',
    (await geefVrij(env, { wat: 'beide', uitvoeren: true }, 'ann@club.be')).status, 403);
}

console.log('\n10. Er gaat mail naar beheerders, niet naar de officials');
{
  const env = nieuweEnv();
  env.DB.exec("UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender'");
  env.RESEND_API_KEY = 're_test';

  const verzonden = [];
  globalThis.fetch = async (url, opties) => {
    verzonden.push(JSON.parse(opties.body));
    return { ok: true, json: async () => ({}) };
  };

  await geefVrij(env, { wat: 'beide', maand: '2026-10', uitvoeren: true });

  const ontvangers = verzonden.map((m) => m.to).sort();
  check('beide beheerders', ontvangers, ['baas2@club.be', 'baas@club.be']);
  check('niet naar de betrokken officials', ontvangers.includes('ann@club.be'), false);
  check('overzicht met aantallen in de tekst', /Aanduidingen vrijgegeven: 2/.test(verzonden[0].text), true);
  check('en met de namen', /Ann Aerts/.test(verzonden[0].text), true);
  check('vermeldt dat de officials niets kregen',
    /geen bericht/.test(verzonden[0].text), true);
}

console.log('\n11. Verwittigen kan uit');
{
  const env = nieuweEnv();
  env.DB.exec("UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender'");
  env.RESEND_API_KEY = 're_test';

  const verzonden = [];
  globalThis.fetch = async (url, opties) => { verzonden.push(JSON.parse(opties.body)); return { ok: true, json: async () => ({}) }; };

  await geefVrij(env, { wat: 'aanduidingen', maand: '2026-10', uitvoeren: true, verwittigen: false });
  check('geen enkele mail', verzonden.length, 0);
  check('maar wel uitgevoerd',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE match_guid='OKT' AND status='vrijgegeven'"), 2);
}

console.log('\n12. De actie komt in het logboek');
{
  const env = nieuweEnv();
  await geefVrij(env, { wat: 'beide', maand: '2026-10', uitvoeren: true });

  const regel = await env.DB.prepare(
    "SELECT * FROM logboek WHERE soort = 'bulk'").first();
  check('één regel gelogd', Boolean(regel), true);
  check('als beheeractie', regel.categorie, 'beheer');
  check('met wie het deed', regel.wie, 'baas@club.be');
  check('welke periode', regel.oud, '2026-10');
  check('en de aantallen', /2 aanduiding\(en\), 3 beschikbaarheid/.test(regel.nieuw), true);
}

console.log('\n13. Een lege maand doet niets');
{
  const env = nieuweEnv();
  const r = await geefVrij(env, { wat: 'beide', maand: '2026-12', uitvoeren: true });
  check('niets geraakt', [r.json.aantalAanduidingen, r.json.aantalBeschikbaarheden], [0, 0]);
  check('alles blijft staan',
    await tel(env, "SELECT COUNT(*) AS n FROM assignments WHERE status='toegewezen'"), 6);
}

console.log(f === 0 ? '\n=== ALLE VRIJGEEFTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
