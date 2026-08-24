/**
 * Sorteervolgordes.
 *
 * De zichtbaarheidsregels zelf worden end-to-end getest in aanduiding.test.mjs,
 * door de echte Worker heen. Een nagebouwde query hier zou stilletijds uit de
 * pas lopen met de echte en dus vals vertrouwen geven.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

const db = new D1Shim();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
db.exec(`
INSERT INTO clubs (guid,naam) VALUES ('BVBL1053','BC Alpha');
INSERT INTO users (email,voornaam,achternaam,profiel,club_guid) VALUES
  ('a@x.be','Ann','Aerts','YO','BVBL1053'),
  ('b@x.be','Bert','van Geijstelen','YO+','BVBL1053'),
  ('c@x.be','Cis','Van Meerbeeck','YO','BVBL1053'),
  ('d@x.be','Dirk','Willems','YO+','BVBL1053');
INSERT INTO teams (guid,club_guid,naam,cat_code) VALUES
  ('BVBL1053G12  1','BVBL1053','G12 A','G12');
INSERT INTO matches (guid,seizoen,club_guid,thuis_guid,thuis_naam,uit_naam,datum,uur,hash) VALUES
  ('M1','2627','BVBL1053','BVBL1053G12  1','beta','X','2026-09-12','14:00','h1'),
  ('M2','2627','BVBL1053','BVBL1053G12  1','Alfa','X','2026-09-12','14:00','h2'),
  ('M3','2627','BVBL1053','BVBL1053G12  1','Gamma','X','2026-09-12','10:00','h3'),
  ('M4','2627','BVBL1053','BVBL1053G12  1','Delta','X','2026-09-11','20:00','h4');
`);

console.log('\nOfficials sorteren op achternaam, hoofdletterongevoelig');
{
  const { results } = await db.prepare(
    `SELECT voornaam || ' ' || achternaam AS n FROM users
      ORDER BY achternaam COLLATE NOCASE, voornaam COLLATE NOCASE`).all();
  check('kleine v tussen de V-namen', results.map(r => r.n),
    ['Ann Aerts', 'Bert van Geijstelen', 'Cis Van Meerbeeck', 'Dirk Willems']);

  const { results: fout } = await db.prepare(
    'SELECT achternaam AS n FROM users ORDER BY achternaam').all();
  check('zonder NOCASE gaat het mis (bewijs)', fout.map(r => r.n),
    ['Aerts', 'Van Meerbeeck', 'Willems', 'van Geijstelen']);
}

console.log('\nWedstrijden sorteren op datum, uur, ploegnaam');
{
  const { results } = await db.prepare(
    `SELECT guid FROM matches ORDER BY datum, uur, thuis_naam COLLATE NOCASE`).all();
  check('datum eerst, dan uur, dan ploeg', results.map(r => r.guid), ['M4', 'M3', 'M2', 'M1']);
}

console.log(f === 0 ? '\n=== SORTEERTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
