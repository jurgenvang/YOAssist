/**
 * Tests voor de aanduidingsregels en het toewijzingsproces.
 * De rekenregels eerst los, dan het geheel door de Worker.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { aantalNodig, botst, opkomstUur, alsMinuten } from '../src/lib/aanduiding.js';

let mislukt = 0;
const check = (naam, echt, verwacht) => {
  const ok = JSON.stringify(echt) === JSON.stringify(verwacht);
  if (!ok) { mislukt++; console.log(`  FOUT ${naam}: kreeg ${JSON.stringify(echt)}, verwacht ${JSON.stringify(verwacht)}`); }
  else console.log(`  ok   ${naam}`);
};

console.log('\n1. Hoeveel officials er nog nodig zijn');
check('geen VBL-ref: twee nodig', aantalNodig(0), 2);
check('één VBL-ref: nog één', aantalNodig(1), 1);
check('twee VBL-refs: geen', aantalNodig(2), 0);
check('meer dan twee: geen negatief getal', aantalNodig(3), 0);
check('onzin telt als nul', aantalNodig(null), 2);

console.log('\n2. Botsingen, gemeten van aanvang tot aanvang');
const zaalA = 'ACC1', zaalB = 'ACC2';
const w = (uur, acc, datum = '2026-09-12') => ({ guid: uur + acc, datum, uur, accGuid: acc });

check('zelfde zaal, 2u ertussen: mag',        botst(w('14:00', zaalA), w('16:00', zaalA)), false);
check('zelfde zaal, 1u59 ertussen: botst',    botst(w('14:00', zaalA), w('15:59', zaalA)), true);
check('zelfde zaal, exact tegelijk: botst',   botst(w('14:00', zaalA), w('14:00', zaalA)), true);
check('andere zaal, 2u ertussen: botst',      botst(w('14:00', zaalA), w('16:00', zaalB)), true);
check('andere zaal, 2u30 ertussen: mag',      botst(w('14:00', zaalA), w('16:30', zaalB)), false);
check('andere zaal, 2u29 ertussen: botst',    botst(w('14:00', zaalA), w('16:29', zaalB)), true);
check('volgorde maakt niet uit',              botst(w('16:00', zaalA), w('14:00', zaalA)), false);
check('andere dag: geen botsing',
  botst(w('14:00', zaalA, '2026-09-12'), w('14:00', zaalA, '2026-09-13')), false);
check('over middernacht heen wordt correct gerekend',
  botst(w('23:30', zaalA, '2026-09-12'), w('00:30', zaalA, '2026-09-13')), true);
check('onbekende zaal telt als verplaatsing',
  botst({ ...w('14:00', null), accGuid: null }, { ...w('16:00', null), accGuid: null }), true);

console.log('\n3. Opkomsttijd');
check('20 minuten eerder', opkomstUur('14:30'), '14:10');
check('over het uur heen', opkomstUur('14:10'), '13:50');
check('over middernacht', opkomstUur('00:10'), '23:50');
check('onzin geeft null', opkomstUur('geen uur'), null);
check('minuten kloppen', alsMinuten('2026-09-12', '14:30') - alsMinuten('2026-09-12', '12:30'), 120);

// ---------------------------------------------------------------------------
const CLUB = 'BVBL1125';
const morgen = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const d = morgen();
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES
      ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12'),
      ('${CLUB}J16  1', '${CLUB}', 'J16 A', 'J16');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('yo@club.be',   'Ann',    'Aerts',          0, 'YO',  '${CLUB}'),
      ('plus@club.be', 'Bert',   'Bosmans',        0, 'YO+', '${CLUB}');
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, locatie, acc_guid, cat_code, off_namen, off_aantal,
                         scope, scope_reden, hash) VALUES
      ('U12A','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast','${d}','14:00','Noord','ACC1','G12','[]',0,1,'auto','h1'),
      ('U12B','2627','${CLUB}','${CLUB}G12  1','G12 B','Gast','${d}','15:00','Noord','ACC1','G12','[]',0,1,'auto','h2'),
      ('U12C','2627','${CLUB}','${CLUB}G12  1','G12 C','Gast','${d}','18:00','Zuid','ACC2','G12','[]',0,1,'auto','h3'),
      ('J16A','2627','${CLUB}','${CLUB}J16  1','J16 A','Gast','${d}','20:00','Noord','ACC1','J16','[]',0,0,NULL,'h4'),
      ('J16B','2627','${CLUB}','${CLUB}J16  1','J16 B','Gast','${d}','10:00','Noord','ACC1','J16','["Yves Knubben"]',1,1,'woensdag','h5');
  `);
  return { DB: db, ENVIRONMENT: 'development' };
}

async function vraag(env, pad, { methode = 'GET', alsWie = null, body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json };
}

const wijs = (env, guid, email, forceer = false) =>
  vraag(env, '/api/admin/aanduiding', { methode: 'POST', alsWie: 'baas@club.be', body: { matchGuid: guid, email, forceer } });

console.log('\n4. Zichtbaarheid volgens scope en profiel');
{
  const env = nieuweEnv();
  const yo = await vraag(env, '/api/matches', { alsWie: 'yo@club.be' });
  check('YO ziet alleen U10/U12 in scope', yo.json.matches.map((m) => m.guid), ['U12A', 'U12B', 'U12C']);

  const plus = await vraag(env, '/api/matches', { alsWie: 'plus@club.be' });
  check('YO+ ziet alles in scope', plus.json.matches.map((m) => m.guid), ['J16B', 'U12A', 'U12B', 'U12C']);
  check('J16A staat buiten scope', plus.json.matches.some((m) => m.guid === 'J16A'), false);

  const j16b = plus.json.matches.find((m) => m.guid === 'J16B');
  check('nog één nodig want VBL duidde er één aan', j16b.nodig, 1);
  check('U12 heeft er twee nodig', plus.json.matches.find((m) => m.guid === 'U12A').nodig, 2);
  check('opkomsttijd meegestuurd', j16b.opkomst, '09:40');
}

console.log('\n5. Toewijzen');
{
  const env = nieuweEnv();
  check('toewijzen lukt', (await wijs(env, 'U12A', 'yo@club.be')).status, 200);
  check('tweede official lukt', (await wijs(env, 'U12A', 'plus@club.be')).status, 200);
  check('derde is volzet', (await wijs(env, 'U12A', 'baas@club.be')).status, 409);
  check('dezelfde tweemaal geweigerd', (await wijs(env, 'U12A', 'yo@club.be')).status, 409);

  check('YO buiten profiel geweigerd', (await wijs(env, 'J16B', 'yo@club.be')).status, 409);
  check('YO+ mag wel op J16', (await wijs(env, 'J16B', 'plus@club.be')).status, 200);
  check('J16B is daarmee volzet', (await wijs(env, 'J16B', 'baas@club.be')).status, 409);

  check('buiten scope geweigerd', (await wijs(env, 'J16A', 'plus@club.be')).status, 409);
  check('onbekende wedstrijd', (await wijs(env, 'BESTAATNIET', 'yo@club.be')).status, 404);
  check('onbekende gebruiker', (await wijs(env, 'U12B', 'niemand@x.be')).status, 404);
}

console.log('\n6. Conflictcontrole bij het toewijzen');
{
  const env = nieuweEnv();
  await wijs(env, 'U12A', 'plus@club.be');           // 14:00 zaal Noord

  const botsing = await wijs(env, 'U12B', 'plus@club.be');   // 15:00 zelfde zaal
  check('botsing geweigerd', botsing.status, 409);
  check('meldt welke wedstrijd', /G12 A/.test(botsing.json.detail), true);

  const forceren = await wijs(env, 'U12B', 'plus@club.be', true);
  check('forceren mag', forceren.status, 200);
  check('en wordt gemeld', forceren.json.geforceerd, true);

  const verder = await wijs(env, 'U12C', 'yo@club.be');       // 18:00 andere zaal
  check('ruim genoeg ertussen', verder.status, 200);
}

console.log('\n7. Niet-beschikbaar wordt gesignaleerd, niet verboden');
{
  const env = nieuweEnv();
  env.DB.exec("INSERT INTO availability (user_email, match_guid, status) VALUES ('yo@club.be','U12A','nee')");

  const geweigerd = await wijs(env, 'U12A', 'yo@club.be');
  check('waarschuwing bij niet-beschikbaar', geweigerd.status, 409);
  check('met uitleg', /niet beschikbaar/i.test(geweigerd.json.detail), true);
  check('forceren lukt', (await wijs(env, 'U12A', 'yo@club.be', true)).status, 200);
}

console.log('\n8. Beschikbaarheid vergrendelt na toewijzing');
{
  const env = nieuweEnv();
  const zet = (status) => vraag(env, '/api/availability',
    { methode: 'POST', alsWie: 'yo@club.be', body: { matchGuid: 'U12A', status } });

  check('vooraf wijzigen mag', (await zet('ja')).status, 200);
  await wijs(env, 'U12A', 'yo@club.be');
  check('daarna niet meer', (await zet('nee')).status, 409);
  check('ook niet wissen', (await zet(null)).status, 409);

  const lijst = await vraag(env, '/api/matches', { alsWie: 'yo@club.be' });
  check('lijst toont de aanduiding', lijst.json.matches.find((m) => m.guid === 'U12A').toegewezen, true);
}

console.log('\n9. Probleem melden');
{
  const env = nieuweEnv();
  const meld = (guid, bericht) => vraag(env, '/api/probleem',
    { methode: 'POST', alsWie: 'yo@club.be', body: { matchGuid: guid, bericht } });

  check('zonder aanduiding kan niet', (await meld('U12A', 'Ik kan niet')).status, 404);
  await wijs(env, 'U12A', 'yo@club.be');
  check('met aanduiding lukt', (await meld('U12A', 'Ziek geworden')).status, 200);
  check('leeg bericht geweigerd', (await meld('U12A', '  ')).status, 400);

  const open = await vraag(env, '/api/admin/problemen', { alsWie: 'baas@club.be' });
  check('beheerder ziet de melding', open.json.problemen.length, 1);
  check('met naam erbij', open.json.problemen[0].naam, 'Ann Aerts');
  check('en de wedstrijd', /G12 A/.test(open.json.problemen[0].wedstrijd), true);

  await vraag(env, '/api/admin/problemen',
    { methode: 'PATCH', alsWie: 'baas@club.be', body: { id: open.json.problemen[0].id } });
  check('afgehandeld verdwijnt uit de lijst',
    (await vraag(env, '/api/admin/problemen', { alsWie: 'baas@club.be' })).json.problemen.length, 0);
}

console.log('\n10. Vrijgeven');
{
  const env = nieuweEnv();
  await wijs(env, 'U12A', 'yo@club.be');

  const vrij = await vraag(env, '/api/admin/aanduiding?matchGuid=U12A&email=yo@club.be',
    { methode: 'DELETE', alsWie: 'baas@club.be' });
  check('vrijgeven lukt', vrij.status, 200);

  const lijst = await vraag(env, '/api/matches', { alsWie: 'yo@club.be' });
  check('niet meer toegewezen', lijst.json.matches.find((m) => m.guid === 'U12A').toegewezen, false);

  check('beschikbaarheid weer wijzigbaar',
    (await vraag(env, '/api/availability',
      { methode: 'POST', alsWie: 'yo@club.be', body: { matchGuid: 'U12A', status: 'nee' } })).status, 200);
  check('plaats weer vrij', (await wijs(env, 'U12A', 'plus@club.be')).status, 200);
  check('onbestaande aanduiding vrijgeven',
    (await vraag(env, '/api/admin/aanduiding?matchGuid=U12C&email=yo@club.be',
      { methode: 'DELETE', alsWie: 'baas@club.be' })).status, 404);
}

console.log('\n11. Scope handmatig zetten');
{
  const env = nieuweEnv();
  const zet = (guid, scope) => vraag(env, '/api/admin/scope',
    { methode: 'PATCH', alsWie: 'baas@club.be', body: { matchGuid: guid, scope } });

  check('in scope zetten lukt', (await zet('J16A', true)).status, 200);
  const plus = await vraag(env, '/api/matches', { alsWie: 'plus@club.be' });
  check('YO+ ziet ze nu', plus.json.matches.some((m) => m.guid === 'J16A'), true);
  check('YO nog altijd niet',
    (await vraag(env, '/api/matches', { alsWie: 'yo@club.be' })).json.matches.some((m) => m.guid === 'J16A'), false);

  check('weer uitzetten lukt', (await zet('J16A', false)).status, 200);
  const uit = await env.DB.prepare('SELECT scope, scope_uit FROM matches WHERE guid = ?').bind('J16A').first();
  check('scope_uit onthouden', [uit.scope, uit.scope_uit], [0, 1]);

  await zet('U12A', true);
  await wijs(env, 'U12A', 'yo@club.be');
  const geblokkeerd = await zet('U12A', false);
  check('met aanduidingen kan scope niet uit', geblokkeerd.status, 409);

  check('YO mag scope niet zetten',
    (await vraag(env, '/api/admin/scope',
      { methode: 'PATCH', alsWie: 'yo@club.be', body: { matchGuid: 'U12A', scope: false } })).status, 403);
}

console.log('\n12. Overzicht toont aanduidingen');
{
  const env = nieuweEnv();
  await wijs(env, 'U12A', 'yo@club.be');
  await wijs(env, 'U12A', 'plus@club.be');

  const o = await vraag(env, '/api/admin/overzicht?dagen=14', { alsWie: 'baas@club.be' });
  const m = o.json.wedstrijden.find((x) => x.guid === 'U12A');
  check('toegewezen officials met naam',
    m.toegewezen.map((t) => t.naam), ['Ann Aerts', 'Bert Bosmans']);
  check('aantal nodig', m.nodig, 2);
  check('scope en reden', [m.inScope, m.scopeReden], [true, 'auto']);
  check('telling onvolledig', o.json.onvolledig, 3);
  check('telling in scope', o.json.inScope, 4);
}

console.log('\n13. De officiallijst toont wie er op de wedstrijd staat');
{
  const env = nieuweEnv();
  // Eén wedstrijd met een VBL-ref, en twee eigen aanduidingen op een andere.
  await wijs(env, 'U12A', 'yo@club.be');
  await wijs(env, 'U12A', 'plus@club.be');

  const lijst = await vraag(env, '/api/matches', { alsWie: 'yo@club.be' });
  const u12a = lijst.json.matches.find((m) => m.guid === 'U12A');

  check('clubrefs met naam, gesorteerd op achternaam',
    u12a.clubRefs.map((p) => p.naam), ['Ann Aerts', 'Bert Bosmans']);
  check('de eigen naam is gemarkeerd',
    u12a.clubRefs.find((p) => p.naam === 'Ann Aerts').ikZelf, true);
  check('die van een ander niet',
    u12a.clubRefs.find((p) => p.naam === 'Bert Bosmans').ikZelf, false);
  check('bezet telt de clubrefs', u12a.bezet, 2);

  const plus = await vraag(env, '/api/matches', { alsWie: 'plus@club.be' });
  const j16b = plus.json.matches.find((m) => m.guid === 'J16B');
  check('VBL-namen zichtbaar', j16b.vblRefs, ['Yves Knubben']);
  check('aantal van de bond', j16b.vblAantal, 1);
  check('namen nog niet gewist', j16b.vblNamenGewist, false);
}

console.log('\n14. Refs zijn zichtbaar zonder eigen betrokkenheid');
{
  const env = nieuweEnv();
  await wijs(env, 'U12B', 'plus@club.be');

  // Ann staat er zelf niet op en heeft niets geantwoord.
  const lijst = await vraag(env, '/api/matches', { alsWie: 'yo@club.be' });
  const u12b = lijst.json.matches.find((m) => m.guid === 'U12B');

  check('ziet toch wie er staat', u12b.clubRefs.map((p) => p.naam), ['Bert Bosmans']);
  check('en dat het niet zijzelf is', u12b.clubRefs[0].ikZelf, false);
  check('geen eigen aanduiding', u12b.toegewezen, false);
}

console.log('\n15. Gewiste VBL-namen tonen enkel nog het aantal');
{
  const env = nieuweEnv();
  env.DB.exec("UPDATE matches SET off_namen = NULL, off_gewist = 1, off_aantal = 2 WHERE guid = 'U12A'");
  const lijst = await vraag(env, '/api/matches', { alsWie: 'yo@club.be' });
  const u12a = lijst.json.matches.find((m) => m.guid === 'U12A');
  check('geen namen meer', u12a.vblRefs, []);
  check('aantal blijft', u12a.vblAantal, 2);
  check('als gewist gemarkeerd', u12a.vblNamenGewist, true);
}

console.log('\n16. Bevestigen dat er twee refs zijn buiten VBL om');
{
  const env = nieuweEnv();

  const r = await vraag(env, '/api/admin/refs-bevestigd',
    { methode: 'PATCH', alsWie: 'baas@club.be', body: { matchGuid: 'J16B', bevestigd: true } });
  check('gelukt', r.status, 200);

  const rij = await env.DB.prepare(
    'SELECT refs_bevestigd, refs_bevestigd_door FROM matches WHERE guid = ?').bind('J16B').first();
  check('vlag staat aan', rij.refs_bevestigd, 1);
  check('met wie het deed', rij.refs_bevestigd_door, 'baas@club.be');

  // De vlag mag niets veranderen aan hoeveel officials er nodig zijn.
  const overzicht = await vraag(env, '/api/admin/overzicht', { alsWie: 'baas@club.be' });
  const j16b = overzicht.json.wedstrijden.find((w) => w.guid === 'J16B');
  check('aantal nodig ongewijzigd', j16b.nodig, 1);
  check('wel als bevestigd gemeld', j16b.refsBevestigd, true);

  const uit = await vraag(env, '/api/admin/refs-bevestigd',
    { methode: 'PATCH', alsWie: 'baas@club.be', body: { matchGuid: 'J16B', bevestigd: false } });
  check('intrekken lukt', uit.status, 200);
  check('vlag staat uit', (await env.DB.prepare(
    'SELECT refs_bevestigd FROM matches WHERE guid = ?').bind('J16B').first()).refs_bevestigd, 0);
}

console.log('\n17. Bevestigen kan niet als de bond er al twee heeft');
{
  const env = nieuweEnv();
  env.DB.exec("UPDATE matches SET off_aantal = 2 WHERE guid = 'J16B'");

  const r = await vraag(env, '/api/admin/refs-bevestigd',
    { methode: 'PATCH', alsWie: 'baas@club.be', body: { matchGuid: 'J16B', bevestigd: true } });
  check('geweigerd', r.status, 409);
  check('met uitleg', /al twee/.test(r.json.detail), true);
}

console.log('\n18. Enkel beheerders, en enkel bestaande wedstrijden');
{
  const env = nieuweEnv();
  check('YO mag niet bevestigen',
    (await vraag(env, '/api/admin/refs-bevestigd',
      { methode: 'PATCH', alsWie: 'yo@club.be', body: { matchGuid: 'J16B', bevestigd: true } })).status, 403);
  check('onbekende wedstrijd',
    (await vraag(env, '/api/admin/refs-bevestigd',
      { methode: 'PATCH', alsWie: 'baas@club.be', body: { matchGuid: 'BESTAATNIET', bevestigd: true } })).status, 404);
  check('zonder guid',
    (await vraag(env, '/api/admin/refs-bevestigd',
      { methode: 'PATCH', alsWie: 'baas@club.be', body: { bevestigd: true } })).status, 400);
}

console.log('\n19. Een beheerder kan kijken als gewone official');
{
  const env = nieuweEnv();

  const volledig = await vraag(env, '/api/matches', { alsWie: 'plus@club.be' });
  check('een YO+ ziet ook andere categorieën',
    volledig.json.matches.some((m) => m.catGroep !== 'U10U12'), true);
  check('profiel gemeld', volledig.json.profiel, 'YO+');

  const alsYo = await vraag(env, '/api/matches?alsProfiel=YO', { alsWie: 'plus@club.be' });
  check('met de schakelaar enkel U10/U12',
    [...new Set(alsYo.json.matches.map((m) => m.catGroep))], ['U10U12']);
  check('en dat wordt gemeld', alsYo.json.profiel, 'YO');
  check('dus minder wedstrijden',
    alsYo.json.matches.length < volledig.json.matches.length, true);
}

console.log('\n20. De schakelaar kan nooit méér tonen');
{
  const env = nieuweEnv();

  const eerlijk = await vraag(env, '/api/matches', { alsWie: 'yo@club.be' });
  const poging = await vraag(env, '/api/matches?alsProfiel=YO%2B', { alsWie: 'yo@club.be' });
  check('een YO wordt er geen YO+ mee', poging.json.matches.length, eerlijk.json.matches.length);
  check('nog steeds enkel U10/U12',
    [...new Set(poging.json.matches.map((m) => m.catGroep))], ['U10U12']);
  check('en het profiel blijft YO', poging.json.profiel, 'YO');

  const onzin = await vraag(env, '/api/matches?alsProfiel=BEHEERDER', { alsWie: 'plus@club.be' });
  check('een onbekende waarde verandert niets',
    onzin.json.matches.length,
    (await vraag(env, '/api/matches', { alsWie: 'plus@club.be' })).json.matches.length);
}

console.log(mislukt === 0 ? '\n=== ALLE AANDUIDINGSTESTS GESLAAGD ===' : `\n=== ${mislukt} TESTS GEFAALD ===`);
process.exit(mislukt ? 1 : 0);
