/**
 * Tests voor de resetfuncties.
 *
 * Het gevaarlijkste onderdeel van de app: alles hier wist gegevens
 * onherroepelijk. De tests leggen daarom vooral vast wat er NIET verdwijnt.
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
const CLUBNAAM = 'AB InBev Leuven Bears';
const TEAM = `${CLUB}G12  1`;

/** Een databank met van alles wat, zodat elke reset iets te wissen heeft. */
function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', '${CLUBNAAM}');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES ('${TEAM}', '${CLUB}', 'G12 A', 'G12');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be',  'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('baas2@club.be', 'Fluppe', 'Van Meerbeeck',  1, 'YO+', '${CLUB}'),
      ('ann@club.be',   'Ann',    'Aerts',          0, 'YO',  '${CLUB}');
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, cat_code, off_aantal, scope, hash)
      VALUES ('M1','2627','${CLUB}','${TEAM}','G12 A','Gast','2099-09-12','14:00','G12',0,1,'h1');
    INSERT INTO availability (user_email, match_guid, status) VALUES ('ann@club.be','M1','ja');
    INSERT INTO assignments (match_guid, user_email, toegewezen_door)
      VALUES ('M1','ann@club.be','baas@club.be');
    INSERT INTO problemen (match_guid, user_email, bericht) VALUES ('M1','ann@club.be','Ziek');
    INSERT INTO logboek (categorie, soort, wie, veld) VALUES ('beheer','club','baas@club.be','iets');
    INSERT INTO sync_runs (bron, status) VALUES ('handmatig','ok');
    INSERT INTO push_abonnementen (user_email, endpoint, p256dh, auth)
      VALUES ('ann@club.be','https://fcm.googleapis.com/x/1','a','b');
  `);
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

const tel = async (env, tabel) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${tabel}`).first()).n;

const doeReset = (env, niveau, bevestiging, alsWie = 'baas@club.be') =>
  vraag(env, '/api/admin/reset', { methode: 'POST', alsWie, body: { niveau, bevestiging } });

console.log('\n1. Overzicht vooraf');
{
  const env = nieuweEnv();
  const r = await vraag(env, '/api/admin/reset');

  check('vier niveaus', r.json.niveaus.map((n) => n.sleutel),
    ['wedstrijden', 'teams', 'clubgegevens', 'alles']);
  check('bevestigwoord is de clubnaam', r.json.bevestigWoord, CLUBNAAM);
  check('lichte niveaus met een gewone knop',
    r.json.niveaus.slice(0, 2).map((n) => n.bevestiging), ['knop', 'knop']);
  check('zware niveaus vragen de naam',
    r.json.niveaus.slice(2).map((n) => n.bevestiging), ['naam', 'naam']);

  const wedstrijden = r.json.niveaus[0];
  check('toont welke tabellen geraakt worden',
    wedstrijden.raakt.map((x) => x.tabel).sort(),
    ['assignments', 'availability', 'matches', 'problemen']);
  check('met de huidige aantallen erbij', wedstrijden.totaal, 4);
}

console.log('\n2. Wedstrijden wissen laat de rest staan');
{
  const env = nieuweEnv();
  const r = await doeReset(env, 'wedstrijden');

  check('gelukt', r.status, 200);
  check('wedstrijden weg', await tel(env, 'matches'), 0);
  check('beschikbaarheden weg', await tel(env, 'availability'), 0);
  check('aanduidingen weg', await tel(env, 'assignments'), 0);
  check('problemen weg', await tel(env, 'problemen'), 0);

  check('ploegen blijven', await tel(env, 'teams'), 1);
  check('gebruikers blijven', await tel(env, 'users'), 3);
  check('clubs blijven', await tel(env, 'clubs'), 1);
  check('push-abonnementen blijven', await tel(env, 'push_abonnementen'), 1);
}

console.log('\n3. Ploegen erbij');
{
  const env = nieuweEnv();
  await doeReset(env, 'teams');

  check('ploegen weg', await tel(env, 'teams'), 0);
  check('clubs blijven', await tel(env, 'clubs'), 1);
  check('gebruikers blijven', await tel(env, 'users'), 3);
  check('logboek blijft', (await tel(env, 'logboek')) >= 1, true);
}

console.log('\n4. Clubgegevens: gebruikers blijven, ook hun voorkeuren');
{
  const env = nieuweEnv();
  env.DB.exec("UPDATE users SET kanaal_push = 1, herinner_ochtend = 0 WHERE email = 'ann@club.be'");

  const zonder = await doeReset(env, 'clubgegevens');
  check('zonder bevestiging geweigerd', zonder.status, 400);
  check('en er is niets gebeurd', await tel(env, 'clubs'), 1);

  const fout = await doeReset(env, 'clubgegevens', 'verkeerde naam');
  check('verkeerde bevestiging geweigerd', fout.status, 400);

  const goed = await doeReset(env, 'clubgegevens', CLUBNAAM);
  check('juiste bevestiging lukt', goed.status, 200);
  check('clubs weg', await tel(env, 'clubs'), 0);
  check('gebruikers blijven', await tel(env, 'users'), 3);

  const ann = await env.DB.prepare("SELECT kanaal_push, herinner_ochtend FROM users WHERE email='ann@club.be'").first();
  check('en hun voorkeuren ook', [ann.kanaal_push, ann.herinner_ochtend], [1, 0]);
  check('instellingen blijven', (await tel(env, 'settings')) > 0, true);
  check('categorieën blijven', await tel(env, 'categorieen'), 12);
}

console.log('\n5. Volledig opnieuw: enkel het eigen account blijft');
{
  const env = nieuweEnv();
  const r = await doeReset(env, 'alles', CLUBNAAM);

  check('gelukt', r.status, 200);
  check('één gebruiker over', await tel(env, 'users'), 1);

  const over = await env.DB.prepare('SELECT email, club_guid, is_admin FROM users').first();
  check('en dat is wie het deed', over.email, 'baas@club.be');
  check('nog steeds beheerder', over.is_admin, 1);
  check('clubkoppeling losgemaakt', over.club_guid, null);

  check('push-abonnementen weg', await tel(env, 'push_abonnementen'), 0);
  check('categorieën blijven, want die zijn geen clubgegevens',
    await tel(env, 'categorieen'), 12);
}

console.log('\n6. Hoofdletters in de bevestiging maken niet uit');
{
  const env = nieuweEnv();
  const r = await doeReset(env, 'clubgegevens', '  ab inbev LEUVEN bears  ');
  check('spaties en hoofdletters worden genegeerd', r.status, 200);
}

console.log('\n7. De reset komt in het logboek');
{
  const env = nieuweEnv();
  await doeReset(env, 'wedstrijden');

  const regel = await env.DB.prepare("SELECT * FROM logboek WHERE soort = 'reset'").first();
  check('gelogd', Boolean(regel), true);
  check('als beheeractie', regel.categorie, 'beheer');
  check('met wie het deed', regel.wie, 'baas@club.be');
  check('en welk niveau', regel.veld, 'Wedstrijden opnieuw ophalen');
  check('met de aantallen', /matches: 1/.test(regel.nieuw), true);
}

console.log('\n8. Ook als het logboek zelf gewist wordt, blijft de regel staan');
{
  const env = nieuweEnv();
  await doeReset(env, 'clubgegevens', CLUBNAAM);

  const regels = (await env.DB.prepare('SELECT * FROM logboek').all()).results;
  check('precies één regel over', regels.length, 1);
  check('en dat is de reset zelf', regels[0].soort, 'reset');
}

console.log('\n9. Afgesloten maanden blokkeren een reset');
{
  const env = nieuweEnv();
  env.DB.exec(`INSERT INTO afgesloten_maanden (maand, seizoen, afgesloten_door)
               VALUES ('2026-10', '2627', 'baas@club.be')`);

  const r = await doeReset(env, 'wedstrijden');
  check('geweigerd', r.status, 409);
  check('met uitleg over facturatie', /[Ff]acturatie/.test(r.json.detail), true);
  check('en er is niets gewist', await tel(env, 'matches'), 1);
}

console.log('\n10. Validatie en afscherming');
{
  const env = nieuweEnv();
  check('onbekend niveau', (await doeReset(env, 'onzin')).status, 400);
  check('YO mag niet resetten', (await doeReset(env, 'wedstrijden', null, 'ann@club.be')).status, 403);
  check('YO mag het overzicht niet zien',
    (await vraag(env, '/api/admin/reset', { alsWie: 'ann@club.be' })).status, 403);
  check('alles staat er nog', await tel(env, 'matches'), 1);
}

console.log('\n11. Een tweede reset op een lege databank doet niets raars');
{
  const env = nieuweEnv();
  await doeReset(env, 'wedstrijden');
  const tweede = await doeReset(env, 'wedstrijden');
  check('gelukt', tweede.status, 200);
  check('niets meer te wissen', tweede.json.totaal, 0);
}

console.log(f === 0 ? '\n=== ALLE RESETTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
