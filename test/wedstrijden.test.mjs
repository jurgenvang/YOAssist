/**
 * Tests voor het handmatig toevoegen en importeren van wedstrijden.
 * Kernregel: wat uit de API komt wordt nooit stilzwijgend overschreven.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { leesCsv } from '../src/lib/csv.js';
import { synchroniseer } from '../src/lib/sync.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

const CLUB = 'BVBL1125';
const TEAM_G12 = `${CLUB}G12  1`;
const TEAM_J16 = `${CLUB}J16  1`;

function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code, volgen) VALUES
      ('${TEAM_G12}', '${CLUB}', 'G12 A', 'G12', 1),
      ('${TEAM_J16}', '${CLUB}', 'J16 A', 'J16', 1);
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('yo@club.be', 'Ann', 'Aerts', 0, 'YO', '${CLUB}');
  `);
  return { DB: db, ENVIRONMENT: 'development' };
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'baas@club.be', body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json, res };
}

const voegToe = (env, w, alsWie = 'baas@club.be') =>
  vraag(env, '/api/admin/wedstrijden', { methode: 'POST', alsWie, body: w });

const basis = {
  datum: '2026-09-12', uur: '14:00', thuisTeamGuid: TEAM_G12,
  uitNaam: 'BC Gast', locatie: 'Sporthal Noord',
};

console.log('\n1. Een wedstrijd toevoegen');
{
  const env = nieuweEnv();
  const r = await voegToe(env, basis);
  check('toegevoegd', r.status, 200);
  check('U12 komt automatisch in de beschikbaarhedenlijst', r.json.inScope, true);

  const rij = await env.DB.prepare('SELECT * FROM matches WHERE guid = ?').bind(r.json.guid).first();
  check('bron is handmatig', rij.bron, 'handmatig');
  check('thuisnaam overgenomen van de ploeg', rij.thuis_naam, 'G12 A');
  check('categorie van de ploeg', rij.cat_code, 'G12');
  check('locatie bewaard', rij.locatie, 'Sporthal Noord');
  check('in het logboek', (await env.DB.prepare(
    "SELECT soort FROM logboek WHERE match_guid = ?").bind(r.json.guid).first()).soort, 'nieuw');
}

console.log('\n2. Datum- en uurnotaties');
{
  const env = nieuweEnv();
  const belgisch = await voegToe(env, { ...basis, datum: '12-09-2026', uur: '14.00', uitNaam: 'X' });
  check('Belgische datum en punt-uur aanvaard', belgisch.status, 200);
  check('genormaliseerd naar ISO', belgisch.json.datum, '2026-09-12');
  check('en naar dubbelpunt', belgisch.json.uur, '14:00');

  check('onleesbare datum', (await voegToe(env, { ...basis, datum: 'zaterdag' })).status, 400);
  check('onbestaand uur', (await voegToe(env, { ...basis, uur: '25:00' })).status, 400);
  check('onleesbaar uur', (await voegToe(env, { ...basis, uur: 'namiddag' })).status, 400);
}

console.log('\n3. Validatie van ploeg, tegenstander en categorie');
{
  const env = nieuweEnv();
  check('onbekende ploeg', (await voegToe(env, { ...basis, thuisTeamGuid: 'BVBL9999X99  1' })).status, 400);
  check('geen tegenstander', (await voegToe(env, { ...basis, uitNaam: '  ' })).status, 400);
  check('onbekende categorie', (await voegToe(env, { ...basis, categorie: 'ZZZ' })).status, 400);

  const j16 = await voegToe(env, { ...basis, thuisTeamGuid: TEAM_J16, uitNaam: 'Y' });
  check('J16 komt niet automatisch in de lijst', j16.json.inScope, false);
}

console.log('\n4. Dezelfde wedstrijd twee keer');
{
  const env = nieuweEnv();
  await voegToe(env, basis);
  const tweede = await voegToe(env, basis);
  check('geweigerd', tweede.status, 409);
  check('en niet gedupliceerd',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first()).n, 1);

  const geforceerd = await voegToe(env, { ...basis, locatie: 'Sporthal Zuid', overwrite: true });
  check('met overwrite lukt het wel', geforceerd.status, 200);
  check('als overschreven gemeld', geforceerd.json.overschreven, true);
  check('locatie bijgewerkt',
    (await env.DB.prepare('SELECT locatie FROM matches').first()).locatie, 'Sporthal Zuid');
  check('nog steeds één rij',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first()).n, 1);
}

console.log('\n5. Een API-wedstrijd wordt niet zomaar overschreven');
{
  const env = nieuweEnv();
  // Zelfde sleutelgegevens, maar als VBL-wedstrijd in de databank gezet.
  const r = await voegToe(env, basis);
  await env.DB.prepare("UPDATE matches SET bron = 'vbl' WHERE guid = ?").bind(r.json.guid).run();

  const opnieuw = await voegToe(env, { ...basis, locatie: 'Andere zaal' });
  check('geweigerd', opnieuw.status, 409);
  check('met vermelding van de herkomst', /Basketbal Vlaanderen/.test(opnieuw.json.detail), true);
  check('locatie ongewijzigd',
    (await env.DB.prepare('SELECT locatie FROM matches').first()).locatie, 'Sporthal Noord');

  const met = await voegToe(env, { ...basis, locatie: 'Andere zaal', overwrite: true });
  check('met overwrite mag het', met.status, 200);
  check('vorige herkomst gelogd', (await env.DB.prepare(
    "SELECT oud FROM logboek WHERE veld = 'handmatig overschreven'").first()).oud,
    'afkomstig van vbl');
}

console.log('\n6. Overschrijven raakt beschikbaarheden en aanduidingen niet aan');
{
  const env = nieuweEnv();
  const r = await voegToe(env, basis);
  env.DB.exec(`
    INSERT INTO availability (user_email, match_guid, status) VALUES ('yo@club.be', '${r.json.guid}', 'ja');
    INSERT INTO assignments (match_guid, user_email, toegewezen_door)
      VALUES ('${r.json.guid}', 'yo@club.be', 'baas@club.be');
  `);

  await voegToe(env, { ...basis, locatie: 'Verplaatst', overwrite: true });
  check('beschikbaarheid blijft',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM availability').first()).n, 1);
  check('aanduiding blijft',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM assignments').first()).n, 1);
  check('maar de wedstrijd is aangepast',
    (await env.DB.prepare('SELECT locatie FROM matches').first()).locatie, 'Verplaatst');
}

console.log('\n7. De synchronisatie laat handmatige wedstrijden met rust');
{
  const env = nieuweEnv();
  await voegToe(env, basis);

  // De API geeft één andere wedstrijd terug; de handmatige komt er niet in voor.
  globalThis.fetch = async (url) => {
    if (String(url).includes('OrgMatchesByGuid')) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify([{
          guid: 'BVBL26279170INJ1621FAA', wedID: 'X', tTGUID: TEAM_G12, tTNaam: 'G12 A',
          tUGUID: 'BVBL2000G12  1', tUNaam: 'Ander', datumString: '19-09-2026',
          beginTijd: '10.00', accGUID: 'ACC1', accNaam: 'Noord', pouleNaam: 'P', wedOff: [],
        }]),
      };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };

  const rapport = await synchroniseer(env.DB, 'handmatig');
  check('sync geslaagd', rapport.status, 'ok');
  check('de handmatige is niet als verdwenen geteld', rapport.verdwenen, 0);

  const hand = await env.DB.prepare("SELECT status FROM matches WHERE bron = 'handmatig'").first();
  check('en staat nog gewoon actief', hand.status, 'actief');
  check('beide wedstrijden staan er',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first()).n, 2);
}

console.log('\n8. Het sjabloon');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/admin/wedstrijden/template');
  check('als bestand aangeboden',
    r.res.headers.get('Content-Disposition').includes('yoassist-wedstrijden.csv'), true);

  const tekst = await r.res.text();
  check('kolommen', leesCsv(tekst).kolommen,
    ['datum', 'uur', 'thuis_team_guid', 'thuis_naam', 'uit_naam', 'locatie', 'categorie', 'overwrite']);

  const terug = await vraag(env, '/api/admin/wedstrijden/import',
    { methode: 'POST', body: { csv: tekst } });
  check('voorbeeldregel wordt genegeerd', terug.json.aantalNieuw, 0);
  check('en telt niet als fout', terug.json.aantalFouten, 0);
}

console.log('\n9. Import: droogloop en uitvoeren');
{
  const env = nieuweEnv();
  const csv = [
    'datum,uur,thuis_team_guid,uit_naam,locatie,overwrite',
    `2026-09-12,14:00,${TEAM_G12},Gast A,Noord,0`,
    `2026-09-12,16:00,${TEAM_J16},Gast B,Noord,0`,
  ].join('\n');

  const droog = await vraag(env, '/api/admin/wedstrijden/import', { methode: 'POST', body: { csv } });
  check('twee nieuw', droog.json.aantalNieuw, 2);
  check('niet uitgevoerd', droog.json.uitgevoerd, false);
  check('databank leeg', (await env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first()).n, 0);
  check('scope per categorie',
    droog.json.nieuw.map((w) => w.inScope), [true, false]);

  await vraag(env, '/api/admin/wedstrijden/import', { methode: 'POST', body: { csv, uitvoeren: true } });
  check('nu wel weggeschreven',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first()).n, 2);
}

console.log('\n10. Import: botsingen worden gemeld, niet stil overgeslagen');
{
  const env = nieuweEnv();
  await voegToe(env, basis);

  const zonder = [
    'datum,uur,thuis_team_guid,uit_naam,locatie,overwrite',
    `2026-09-12,14:00,${TEAM_G12},BC Gast,Andere zaal,0`,
  ].join('\n');

  const r1 = await vraag(env, '/api/admin/wedstrijden/import', { methode: 'POST', body: { csv: zonder } });
  check('als botsing gemeld', r1.json.aantalBotsingen, 1);
  check('niets nieuw', r1.json.aantalNieuw, 0);
  check('met uitleg over overwrite', /overwrite/.test(r1.json.botsingen[0].reden), true);

  const met = zonder.replace(',0', ',1');
  const r2 = await vraag(env, '/api/admin/wedstrijden/import',
    { methode: 'POST', body: { csv: met, uitvoeren: true } });
  check('met overwrite wel vervangen', r2.json.aantalVervangen, 1);
  check('locatie bijgewerkt',
    (await env.DB.prepare('SELECT locatie FROM matches').first()).locatie, 'Andere zaal');
}

console.log('\n11. Import: fouten per regel');
{
  const env = nieuweEnv();
  const csv = [
    'datum,uur,thuis_team_guid,uit_naam,overwrite',
    `2026-09-12,14:00,${TEAM_G12},Goed,0`,
    `zaterdag,14:00,${TEAM_G12},Foute datum,0`,
    `2026-09-13,14:00,BVBL9999X99  1,Onbekende ploeg,0`,
    `2026-09-14,14:00,${TEAM_G12},,0`,
    `2026-09-15,14:00,${TEAM_G12},Dubbel,0`,
    `2026-09-15,14:00,${TEAM_G12},Dubbel,0`,
  ].join('\n');

  const r = await vraag(env, '/api/admin/wedstrijden/import',
    { methode: 'POST', body: { csv, uitvoeren: true } });
  // Regel 2 en 6 zijn goed; 3 (datum), 4 (ploeg), 5 (tegenstander) en 7 (dubbel) niet.
  check('twee goede', r.json.aantalNieuw, 2);
  check('vier fouten', r.json.aantalFouten, 4);
  check('regelnummers meegegeven', r.json.fouten.map((x) => x.regel), [3, 4, 5, 7]);
  check('dubbel in het bestand gemeld',
    r.json.fouten.some((x) => /twee keer/.test(x.reden)), true);
  check('de goede staan er echt in',
    (await env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first()).n, 2);
}

console.log('\n12. Verwijderen');
{
  const env = nieuweEnv();
  const r = await voegToe(env, basis);

  const weg = await vraag(env, `/api/admin/wedstrijden?guid=${encodeURIComponent(r.json.guid)}`,
    { methode: 'DELETE' });
  check('handmatige wedstrijd mag weg', weg.status, 200);
  check('en is weg', (await env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first()).n, 0);

  const r2 = await voegToe(env, basis);
  await env.DB.prepare("UPDATE matches SET bron = 'vbl' WHERE guid = ?").bind(r2.json.guid).run();
  const vbl = await vraag(env, `/api/admin/wedstrijden?guid=${encodeURIComponent(r2.json.guid)}`,
    { methode: 'DELETE' });
  check('VBL-wedstrijd niet verwijderbaar', vbl.status, 409);

  await env.DB.prepare("UPDATE matches SET bron = 'handmatig' WHERE guid = ?").bind(r2.json.guid).run();
  env.DB.exec(`INSERT INTO assignments (match_guid, user_email, toegewezen_door)
               VALUES ('${r2.json.guid}', 'yo@club.be', 'baas@club.be')`);
  const bezet = await vraag(env, `/api/admin/wedstrijden?guid=${encodeURIComponent(r2.json.guid)}`,
    { methode: 'DELETE' });
  check('met aanduidingen niet verwijderbaar', bezet.status, 409);
}

console.log('\n13. Enkel beheerders');
{
  const env = nieuweEnv();
  check('YO mag niet toevoegen', (await voegToe(env, basis, 'yo@club.be')).status, 403);
  check('YO mag het sjabloon niet',
    (await vraag(env, '/api/admin/wedstrijden/template', { alsWie: 'yo@club.be' })).status, 403);
  check('YO mag niet importeren',
    (await vraag(env, '/api/admin/wedstrijden/import',
      { methode: 'POST', alsWie: 'yo@club.be', body: { csv: 'datum,uur,thuis_team_guid,uit_naam\n2026-09-12,14:00,x,y' } })).status, 403);
}

console.log(f === 0 ? '\n=== ALLE WEDSTRIJDTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
