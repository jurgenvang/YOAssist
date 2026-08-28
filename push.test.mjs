/**
 * Tests voor de planner en de woensdagregel.
 * De planning wordt los getest van de uitvoering: takenVoor() zegt alleen wat
 * er moet gebeuren, en dat is precies wat er fout kan gaan bij zomertijd.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker, { brusselsMoment, takenVoor } from '../src/index.js';
import { komendWeekend, pasWoensdagregelToe, zoekOverbodigeScope } from '../src/lib/woensdag.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

console.log('\n1. Brusselse tijd uit UTC');
{
  // Zomertijd: UTC+2
  check('04:00 UTC in de zomer is 06:00', brusselsMoment(new Date('2026-09-12T04:00:00Z')).uur, 6);
  check('22:00 UTC in de zomer is middernacht', brusselsMoment(new Date('2026-09-12T22:00:00Z')).uur, 0);
  // Wintertijd: UTC+1
  check('05:00 UTC in de winter is 06:00', brusselsMoment(new Date('2026-12-12T05:00:00Z')).uur, 6);
  check('23:00 UTC in de winter is middernacht', brusselsMoment(new Date('2026-12-12T23:00:00Z')).uur, 0);
  check('weekdag klopt (12/09/2026 is een zaterdag)',
    brusselsMoment(new Date('2026-09-12T12:00:00Z')).weekdag, 6);
  check('datum in Brusselse tijd, niet UTC',
    brusselsMoment(new Date('2026-09-12T22:30:00Z')).datum, '2026-09-13');
}

console.log('\n2. Welke taken op welk moment');
{
  const woensdag = 3, zaterdag = 6;
  check('06:00 synchroniseren', takenVoor({ uur: 6, weekdag: 1 }), ['sync']);
  check('12:00 synchroniseren', takenVoor({ uur: 12, weekdag: 1 }), ['sync']);
  check('middernacht synchroniseren', takenVoor({ uur: 0, weekdag: 1 }), ['sync']);
  check('09:00 niets', takenVoor({ uur: 9, weekdag: 2 }), []);
  check('woensdag 14:00 de regel', takenVoor({ uur: 14, weekdag: woensdag }), ['woensdagregel']);
  check('zaterdag 14:00 niets', takenVoor({ uur: 14, weekdag: zaterdag }), []);
  check('20:00 avondcontrole', takenVoor({ uur: 20, weekdag: 1 }), ['avondcontrole']);
  check('19:00 herinnering voor morgen', takenVoor({ uur: 19, weekdag: 1 }), ['herinnering-avond']);
  check('07:00 herinnering voor vandaag', takenVoor({ uur: 7, weekdag: 1 }), ['herinnering-ochtend']);
  check('maandag 08:00 weekoverzicht', takenVoor({ uur: 8, weekdag: 1 }), ['weekoverzicht']);
  check('dinsdag 08:00 niets', takenVoor({ uur: 8, weekdag: 2 }), []);
  check('18:00 enkel sync', takenVoor({ uur: 18, weekdag: woensdag }), ['sync']);
}

console.log('\n3. Het komende weekend bepalen');
{
  // 2026-09-09 is een woensdag
  check('woensdag wijst naar dat weekend',
    komendWeekend(new Date('2026-09-09T12:00:00Z')), ['2026-09-12', '2026-09-13']);
  check('zaterdag wijst naar zichzelf',
    komendWeekend(new Date('2026-09-12T12:00:00Z')), ['2026-09-12', '2026-09-13']);
  check('zondag wijst naar het volgende weekend',
    komendWeekend(new Date('2026-09-13T12:00:00Z')), ['2026-09-19', '2026-09-20']);
}

// ---------------------------------------------------------------------------
const CLUB = 'BVBL1125';

function nieuweDb() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES
      ('${CLUB}J16  1', '${CLUB}', 'J16 A', 'J16');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('plus@club.be', 'Bert', 'Bosmans', 0, 'YO+', '${CLUB}');
  `);
  return db;
}

/** Wedstrijd in het weekend van 12-13 september 2026. */
function wed(db, guid, { datum = '2026-09-12', uur = '14:00', off = 0, scope = 0, scopeUit = 0, reden = null } = {}) {
  db.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, acc_guid, cat_code, off_namen, off_aantal,
                         scope, scope_reden, scope_uit, hash)
    VALUES ('${guid}','2627','${CLUB}','${CLUB}J16  1','J16 A','Gast','${datum}','${uur}',
            'ACC1','J16','[]',${off},${scope},${reden ? `'${reden}'` : 'NULL'},${scopeUit},'h${guid}')`);
}

console.log('\n4. De woensdagregel');
{
  const db = nieuweDb();
  const woensdag = new Date('2026-09-09T12:00:00Z');

  wed(db, 'GEEN',   { off: 0 });                    // geen refs -> in de lijst
  wed(db, 'EEN',    { off: 1 });                    // één ref  -> in de lijst
  wed(db, 'TWEE',   { off: 2 });                    // twee refs -> niet
  wed(db, 'BUITEN', { off: 0, datum: '2026-09-19' }); // volgend weekend -> niet
  wed(db, 'AL',     { off: 0, scope: 1, reden: 'auto' }); // staat al in de lijst
  wed(db, 'UIT',    { off: 0, scopeUit: 1 });       // bewust uitgezet door beheerder

  const r = await pasWoensdagregelToe(db, woensdag);

  check('twee wedstrijden opgepikt', r.gescoopt, 2);
  check('de juiste', r.wedstrijden.map((w) => w.guid).sort(), ['EEN', 'GEEN']);
  check('venster is het komende weekend', [r.van, r.tot], ['2026-09-12', '2026-09-13']);
  check('nog nodig wordt meegegeven',
    r.wedstrijden.find((w) => w.guid === 'EEN').nogNodig, 1);
  check('nog nodig bij geen enkele ref',
    r.wedstrijden.find((w) => w.guid === 'GEEN').nogNodig, 2);

  const reden = await db.prepare("SELECT scope, scope_reden FROM matches WHERE guid = 'GEEN'").first();
  check('reden vastgelegd', [reden.scope, reden.scope_reden], [1, 'woensdag']);

  const uit = await db.prepare("SELECT scope FROM matches WHERE guid = 'UIT'").first();
  check('bewust uitgezette wedstrijd blijft uit', uit.scope, 0);

  const al = await db.prepare("SELECT scope_reden FROM matches WHERE guid = 'AL'").first();
  check('bestaande reden blijft ongemoeid', al.scope_reden, 'auto');
}

console.log('\n5. Tweemaal draaien verandert niets');
{
  const db = nieuweDb();
  wed(db, 'GEEN', { off: 0 });
  const woensdag = new Date('2026-09-09T12:00:00Z');

  await pasWoensdagregelToe(db, woensdag);
  const tweede = await pasWoensdagregelToe(db, woensdag);
  check('tweede run pikt niets meer op', tweede.gescoopt, 0);
}

console.log('\n6. Avondcontrole');
{
  const db = nieuweDb();
  wed(db, 'BIJGEKOMEN', { off: 2, scope: 1, reden: 'woensdag' });
  wed(db, 'NORMAAL',    { off: 0, scope: 1, reden: 'woensdag' });
  wed(db, 'AUTO',       { off: 2, scope: 1, reden: 'auto' });
  db.exec(`INSERT INTO assignments (match_guid, user_email, toegewezen_door)
           VALUES ('BIJGEKOMEN', 'plus@club.be', 'baas@club.be')`);

  const overbodig = await zoekOverbodigeScope(db);
  check('enkel de woensdagwedstrijd met twee refs', overbodig.map((o) => o.guid), ['BIJGEKOMEN']);
  check('meldt dat er iemand van ons op staat', overbodig[0].eigenToegewezen, 1);
  check('en blijft in de lijst staan',
    (await db.prepare("SELECT scope FROM matches WHERE guid = 'BIJGEKOMEN'").first()).scope, 1);
}

console.log('\n7. De planner voert de juiste taken uit');
{
  const db = nieuweDb();
  wed(db, 'GEEN', { off: 0 });
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => '' });

  const wachten = [];
  const ctx = { waitUntil: (p) => { wachten.push(p); return p; } };

  // Woensdag 14:00 Brussel = 12:00 UTC in de zomer
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-09T12:00:00Z') }, { DB: db }, ctx);
  await Promise.allSettled(wachten);

  check('woensdagregel is uitgevoerd',
    (await db.prepare("SELECT scope FROM matches WHERE guid = 'GEEN'").first()).scope, 1);

  // Dinsdag 09:00 Brussel = 07:00 UTC: geen enkele taak.
  // Niet 07:00 Brussel nemen: dat is sinds de herinneringen een taakuur.
  const voor = wachten.length;
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-08T07:00:00Z') }, { DB: db }, ctx);
  check('op een leeg uur gebeurt niets', wachten.length, voor);
}

console.log('\n8. Herinneringen volgen de voorkeuren van elke official');
{
  const db = nieuweDb();
  db.exec(`
    INSERT INTO users (email, voornaam, achternaam, profiel, club_guid,
                       herinner_avond, herinner_ochtend) VALUES
      ('wil@club.be',  'Wil',  'Alles', 'YO+', '${CLUB}', 1, 1),
      ('geen@club.be', 'Geen', 'Avond', 'YO+', '${CLUB}', 0, 1);
    UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender';
  `);
  wed(db, 'MORGEN', { datum: '2026-09-13', uur: '14:00', scope: 1, reden: 'auto' });
  db.exec(`
    INSERT INTO assignments (match_guid, user_email, toegewezen_door) VALUES
      ('MORGEN', 'wil@club.be', 'baas@club.be'),
      ('MORGEN', 'geen@club.be', 'baas@club.be');
  `);

  const verzonden = [];
  globalThis.fetch = async (url, opties) => {
    verzonden.push(JSON.parse(opties.body));
    return { ok: true, json: async () => ({}) };
  };

  const env = { DB: db, RESEND_API_KEY: 're_test' };
  const ctx = { waitUntil: (p) => p };

  // Zaterdag 12 september 19:00 Brussel = 17:00 UTC in de zomer.
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-12T17:00:00Z') }, env, ctx);
  await new Promise((r) => setTimeout(r, 10));

  const ontvangers = verzonden.map((m) => m.to);
  check('wie de avondherinnering wil, krijgt ze', ontvangers.includes('wil@club.be'), true);
  check('wie ze uitzette niet', ontvangers.includes('geen@club.be'), false);
  check('met de opkomsttijd erin', /13:40/.test(verzonden[0].text), true);
  check('en met de wedstrijd', /J16 A - Gast/.test(verzonden[0].text), true);
}

console.log('\n9. Twee wedstrijden op één dag geven één bericht');
{
  const db = nieuweDb();
  db.exec(`
    INSERT INTO users (email, voornaam, achternaam, profiel, club_guid) VALUES
      ('druk@club.be', 'Druk', 'Bezet', 'YO+', '${CLUB}');
    UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender';
  `);
  wed(db, 'VROEG', { datum: '2026-09-13', uur: '10:00', scope: 1, reden: 'auto' });
  wed(db, 'LAAT',  { datum: '2026-09-13', uur: '16:00', scope: 1, reden: 'auto' });
  db.exec(`
    INSERT INTO assignments (match_guid, user_email, toegewezen_door) VALUES
      ('VROEG', 'druk@club.be', 'baas@club.be'),
      ('LAAT',  'druk@club.be', 'baas@club.be');
  `);

  const verzonden = [];
  globalThis.fetch = async (url, opties) => {
    verzonden.push(JSON.parse(opties.body));
    return { ok: true, json: async () => ({}) };
  };

  const env = { DB: db, RESEND_API_KEY: 're_test' };
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-12T17:00:00Z') },
    env, { waitUntil: (p) => p });
  await new Promise((r) => setTimeout(r, 10));

  const voorDruk = verzonden.filter((m) => m.to === 'druk@club.be');
  check('één bericht, geen twee', voorDruk.length, 1);
  check('met beide wedstrijden erin',
    [/10:00/.test(voorDruk[0].text), /16:00/.test(voorDruk[0].text)], [true, true]);
  check('meervoud in het onderwerp', /2 wedstrijden/.test(voorDruk[0].subject), true);
}

console.log(f === 0 ? '\n=== ALLE PLANNERTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
