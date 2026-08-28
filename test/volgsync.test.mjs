/**
 * Tests voor de aparte synchronisatie van gevolgde clubs (V31).
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import { synchroniseerVolgClubs } from '../src/lib/volgsync.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

function nieuweDb() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return db;
}

function wed(nr, opties = {}) {
  return {
    guid: `BVBLX${nr}`, wedID: `X${nr}`, accGUID: 'ACC1',
    wedOff: opties.wedOff ?? [],
    tTGUID: 'T1', tTNaam: opties.thuisNaam ?? 'Thuis X',
    tUGUID: 'T2', tUNaam: opties.uitNaam ?? 'Uit X',
    datumString: opties.datum ?? '20-09-2026', beginTijd: opties.uur ?? '14.00',
    accNaam: 'Zaal X', pouleNaam: 'P',
    gespeeld: 'N', uitslag: '',
  };
}

function zetApi(perClub, { faal = [] } = {}) {
  globalThis.fetch = async (url) => {
    const m = String(url).match(/issguid=([\w]+)/);
    const guid = m?.[1];
    if (faal.includes(guid)) return { ok: false, status: 503, text: async () => '' };
    if (String(url).includes('OrgMatchesByGuid')) {
      return { ok: true, status: 200, text: async () => JSON.stringify(perClub[guid] ?? []) };
    }
    return { ok: true, status: 200, text: async () => '{}' };
  };
}

console.log('\n1. Zonder gevolgde clubs gebeurt er niets');
{
  const db = nieuweDb();
  const r = await synchroniseerVolgClubs(db);
  check('geen clubs', r.clubs, 0);
  check('niets gevonden', r.gevonden, 0);
}

console.log('\n2. Wedstrijden van een gevolgde club komen binnen');
{
  const db = nieuweDb();
  db.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");
  zetApi({ BVBL9999: [wed(1, { wedOff: [] }), wed(2, { wedOff: ['Piet Peeters'] })] });

  const r = await synchroniseerVolgClubs(db);
  check('één club verwerkt', r.clubs, 1);
  check('twee wedstrijden gevonden', r.gevonden, 2);

  const rijen = (await db.prepare('SELECT guid, vbl_aantal FROM volg_wedstrijden ORDER BY guid').all()).results;
  check('beide bewaard', rijen.length, 2);
  check('nul refs correct geteld', rijen.find((r) => r.guid === 'BVBLX1').vbl_aantal, 0);
  check('één ref correct geteld', rijen.find((r) => r.guid === 'BVBLX2').vbl_aantal, 1);
}

console.log('\n3. Eén falende club blokkeert de andere niet');
{
  const db = nieuweDb();
  db.exec(`
    INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES
      ('BVBL1111', 'Club A', 'baas@club.be'),
      ('BVBL2222', 'Club B', 'baas@club.be');
  `);
  zetApi({ BVBL2222: [wed(3)] }, { faal: ['BVBL1111'] });

  const r = await synchroniseerVolgClubs(db);
  check('twee clubs geprobeerd', r.clubs, 2);
  check('één wedstrijd van de goede club', r.gevonden, 1);
  check('de foute club staat in de fouten', r.fouten.length, 1);
  check('met haar naam erbij', r.fouten[0].includes('Club A'), true);
}

console.log('\n4. Een tweede sync werkt bij in plaats van te verdubbelen');
{
  const db = nieuweDb();
  db.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");
  zetApi({ BVBL9999: [wed(1, { wedOff: [] })] });
  await synchroniseerVolgClubs(db);

  // Nu heeft de bond alsnog een official aangeduid.
  zetApi({ BVBL9999: [wed(1, { wedOff: ['Iemand'] })] });
  await synchroniseerVolgClubs(db);

  const aantal = (await db.prepare('SELECT COUNT(*) AS n FROM volg_wedstrijden').first()).n;
  check('nog steeds één rij', aantal, 1);
  const rij = await db.prepare('SELECT vbl_aantal FROM volg_wedstrijden WHERE guid = ?').bind('BVBLX1').first();
  check('bijgewerkt naar één ref', rij.vbl_aantal, 1);
}

console.log('\n5. Een club loskoppelen ruimt haar wedstrijden op');
{
  const db = nieuweDb();
  db.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");
  zetApi({ BVBL9999: [wed(1)] });
  await synchroniseerVolgClubs(db);
  check('staat er', (await db.prepare('SELECT COUNT(*) AS n FROM volg_wedstrijden').first()).n, 1);

  db.exec("DELETE FROM volg_clubs WHERE guid = 'BVBL9999'");
  await synchroniseerVolgClubs(db);
  check('weg na de volgende sync', (await db.prepare('SELECT COUNT(*) AS n FROM volg_wedstrijden').first()).n, 0);
}

console.log('\n6. Verleden wedstrijden verdwijnen vanzelf');
{
  const db = nieuweDb();
  db.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");
  zetApi({ BVBL9999: [wed(1, { datum: '01-01-2020' }), wed(2, { datum: '20-09-2026' })] });

  const r = await synchroniseerVolgClubs(db);
  check('enkel de toekomstige wordt opgehaald', r.gevonden, 1);
}

console.log('\n7. U10 en U12 worden niet opgehaald, vanaf U14 wel');
{
  const db = nieuweDb();
  db.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");

  const metCategorie = (nr, catCode) => ({
    ...wed(nr),
    tTGUID: `BVBL9999${catCode}  1`,   // club-GUID + categoriecode + twee spaties + volgnummer
  });

  zetApi({
    BVBL9999: [
      metCategorie(1, 'G10'),   // U10, moet eruit gefilterd
      metCategorie(2, 'G12'),   // U12, moet eruit gefilterd
      metCategorie(3, 'M12'),   // U12 meisjes, moet eruit gefilterd
      metCategorie(4, 'J16'),   // U16, hoort erin
      metCategorie(5, 'HSE'),   // senioren, hoort erin
    ],
  });

  const r = await synchroniseerVolgClubs(db);
  check('enkel de twee vanaf U14', r.gevonden, 2);

  const guids = (await db.prepare('SELECT guid FROM volg_wedstrijden').all()).results.map((r) => r.guid);
  check('J16 en HSE erin, U10/U12 niet', guids.sort(), ['BVBLX4', 'BVBLX5']);
}

console.log('\n8. Een oude U10/U12-rij verdwijnt bij de volgende sync');
{
  // Simuleert een rij die vóór deze filter werd opgehaald.
  const db = nieuweDb();
  db.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");
  db.exec(`
    INSERT INTO volg_wedstrijden (guid, club_guid, club_naam, thuis_naam, uit_naam, datum, uur, cat_code, vbl_aantal)
    VALUES ('OUD1', 'BVBL9999', 'Verre Club', 'A', 'B', '2099-01-01', '10:00', 'G10', 0);
  `);
  zetApi({ BVBL9999: [] });

  await synchroniseerVolgClubs(db);
  check('opgeruimd', (await db.prepare('SELECT COUNT(*) AS n FROM volg_wedstrijden').first()).n, 0);
}

console.log('\n9. Wedstrijden om middernacht worden overgeslagen');
{
  const db = nieuweDb();
  db.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");
  zetApi({
    BVBL9999: [
      { ...wed(1, { uur: '00.00' }), tTGUID: 'BVBL9999J16  1' },
      { ...wed(2, { uur: '14.00' }), tTGUID: 'BVBL9999J16  1' },
    ],
  });

  const r = await synchroniseerVolgClubs(db);
  check('enkel de wedstrijd met een echt uur', r.gevonden, 1);

  const rij = await db.prepare('SELECT uur FROM volg_wedstrijden').first();
  check('en dat is niet middernacht', rij.uur, '14:00');
}

console.log('\n10. De naam wordt bewaard bij precies één scheidsrechter');
{
  const db = nieuweDb();
  db.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");
  zetApi({
    BVBL9999: [
      { ...wed(1, { wedOff: [] }), tTGUID: 'BVBL9999J16  1' },              // nul refs
      { ...wed(2, { wedOff: ['Piet Peeters'] }), tTGUID: 'BVBL9999J16  1' }, // één ref
      { ...wed(3, { wedOff: ['A', 'B'] }), tTGUID: 'BVBL9999J16  1' },       // twee refs
    ],
  });

  await synchroniseerVolgClubs(db);
  const rijen = (await db.prepare('SELECT guid, vbl_naam FROM volg_wedstrijden ORDER BY guid').all()).results;

  check('geen naam bij nul refs', rijen.find((r) => r.guid === 'BVBLX1').vbl_naam, null);
  check('wel een naam bij precies één ref',
    rijen.find((r) => r.guid === 'BVBLX2').vbl_naam, 'Piet Peeters');
  check('geen naam bewaard bij twee refs (die komt toch niet op de pagina)',
    rijen.find((r) => r.guid === 'BVBLX3').vbl_naam, null);
}

console.log('\n11. Trekt iemand zich terug, dan verdwijnt de naam weer');
{
  const db = nieuweDb();
  db.exec("INSERT INTO volg_clubs (guid, naam, toegevoegd_door) VALUES ('BVBL9999', 'Verre Club', 'baas@club.be')");

  zetApi({ BVBL9999: [{ ...wed(1, { wedOff: ['Piet Peeters'] }), tTGUID: 'BVBL9999J16  1' }] });
  await synchroniseerVolgClubs(db);
  check('naam staat er eerst',
    (await db.prepare('SELECT vbl_naam FROM volg_wedstrijden WHERE guid = ?').bind('BVBLX1').first()).vbl_naam,
    'Piet Peeters');

  zetApi({ BVBL9999: [{ ...wed(1, { wedOff: [] }), tTGUID: 'BVBL9999J16  1' }] });
  await synchroniseerVolgClubs(db);
  check('en is weer weg zodra er niemand meer aangeduid is',
    (await db.prepare('SELECT vbl_naam FROM volg_wedstrijden WHERE guid = ?').bind('BVBLX1').first()).vbl_naam,
    null);
}

console.log(f === 0 ? '\n=== ALLE VOLGSYNCTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
