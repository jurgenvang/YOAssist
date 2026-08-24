import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';

let f = 0;
const check = (n, e, v) => { const ok = JSON.stringify(e)===JSON.stringify(v);
  if(!ok){f++;console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`);} else console.log(`  ok   ${n}`); };

const db = new D1Shim();
db.exec(readFileSync(new URL('../schema.sql', import.meta.url),'utf8'));
db.exec(`
INSERT INTO clubs (guid,naam) VALUES ('BVBL1053','BC Alpha'),('BVBL2000','BC Beta');
INSERT INTO teams (guid,club_guid,naam,yo,yo_plus,actief) VALUES
  ('BVBL1053J16  1','BVBL1053','U16 A',1,1,1),      -- YO + YO+
  ('BVBL1053HSE  1','BVBL1053','Heren A',0,1,1),    -- enkel YO+
  ('BVBL1053G12  1','BVBL1053','G12 A',0,0,1),      -- geen aanduidingen
  ('BVBL1053J14  1','BVBL1053','U14 A',1,1,0),      -- team niet meer actief
  ('BVBL2000J16  1','BVBL2000','Beta U16',1,1,1);   -- andere club
INSERT INTO users (email,voornaam,achternaam,profiel,club_guid) VALUES
  ('yo@a.be','Ann','Aerts','YO','BVBL1053'),
  ('plus@a.be','Bert','van Geijstelen','YO+','BVBL1053'),
  ('yo@b.be','Cis','Van Meerbeeck','YO','BVBL2000'),
  ('los@x.be','Dirk','Willems','YO',NULL);
INSERT INTO matches (guid,seizoen,club_guid,thuis_guid,thuis_naam,uit_naam,datum,uur,locatie,hash) VALUES
  ('M-YO',     '2627','BVBL1053','BVBL1053J16  1','U16 A','Gamma','2026-09-12','20:30','Noord','h1'),
  ('M-PLUS',   '2627','BVBL1053','BVBL1053HSE  1','Heren A','Delta','2026-09-13','21:00','Noord','h2'),
  ('M-GEEN',   '2627','BVBL1053','BVBL1053G12  1','G12 A','Epsilon','2026-09-14','10:00','Noord','h3'),
  ('M-INACT',  '2627','BVBL1053','BVBL1053J14  1','U14 A','Zeta','2026-09-15','18:00','Noord','h4'),
  ('M-BETA',   '2627','BVBL2000','BVBL2000J16  1','Beta U16','Eta','2026-09-16','20:00','Zuid','h5'),
  ('M-OUD',    '2526','BVBL1053','BVBL1053J16  1','U16 A','Theta','2026-09-17','20:00','Noord','h6'),
  ('M-WEG',    '2627','BVBL1053','BVBL1053J16  1','U16 A','Iota','2026-09-18','20:00','Noord','h7'),
  ('M-VERLEDEN','2627','BVBL1053','BVBL1053J16  1','U16 A','Kappa','2026-08-01','20:00','Noord','h8');
UPDATE matches SET status='verdwenen' WHERE guid='M-WEG';
`);

const VANDAAG='2026-08-24';
async function zicht(email, profiel, clubGuid){
  const kolom = profiel==='YO+' ? 't.yo_plus' : 't.yo';
  const {results} = await db.prepare(`
    SELECT m.guid, a.status AS beschikbaarheid
      FROM matches m
      JOIN teams t ON t.guid = m.thuis_guid
      LEFT JOIN availability a ON a.match_guid = m.guid AND a.user_email = ?
     WHERE m.seizoen='2627' AND m.status='actief' AND m.club_guid=? AND ${kolom}=1
       AND t.actief=1 AND m.datum >= ?
     ORDER BY m.datum, m.uur, m.thuis_naam`).bind(email, clubGuid, VANDAAG).all();
  return results.map(r=>r.guid);
}

console.log('\nZichtbaarheid per profiel');
check('YO ziet enkel YO-teams van eigen club', await zicht('yo@a.be','YO','BVBL1053'), ['M-YO']);
check('YO+ ziet YO- en YO+-teams',            await zicht('plus@a.be','YO+','BVBL1053'), ['M-YO','M-PLUS']);
check('YO van andere club ziet enkel die club', await zicht('yo@b.be','YO','BVBL2000'), ['M-BETA']);
check('verdwenen wedstrijd niet zichtbaar',   (await zicht('yo@a.be','YO','BVBL1053')).includes('M-WEG'), false);
check('vorig seizoen niet zichtbaar',         (await zicht('yo@a.be','YO','BVBL1053')).includes('M-OUD'), false);
check('verleden niet zichtbaar',              (await zicht('yo@a.be','YO','BVBL1053')).includes('M-VERLEDEN'), false);
check('inactief team niet zichtbaar',         (await zicht('yo@a.be','YO','BVBL1053')).includes('M-INACT'), false);
check('team zonder vinkje niet zichtbaar',    (await zicht('yo@a.be','YO','BVBL1053')).includes('M-GEEN'), false);

console.log('\nAutorisatie bij het zetten van beschikbaarheid');
async function mag(email, profiel, clubGuid, guid){
  const kolom = profiel==='YO+' ? 't.yo_plus' : 't.yo';
  const r = await db.prepare(`
    SELECT m.guid FROM matches m JOIN teams t ON t.guid=m.thuis_guid
     WHERE m.guid=? AND m.seizoen='2627' AND m.status='actief'
       AND m.club_guid=? AND ${kolom}=1 AND t.actief=1`).bind(guid, clubGuid).first();
  return Boolean(r);
}
check('YO mag eigen wedstrijd',            await mag('yo@a.be','YO','BVBL1053','M-YO'), true);
check('YO mag GEEN YO+-wedstrijd',         await mag('yo@a.be','YO','BVBL1053','M-PLUS'), false);
check('YO mag GEEN wedstrijd andere club', await mag('yo@a.be','YO','BVBL1053','M-BETA'), false);
check('YO mag GEEN verdwenen wedstrijd',   await mag('yo@a.be','YO','BVBL1053','M-WEG'), false);
check('YO+ mag YO+-wedstrijd',             await mag('plus@a.be','YO+','BVBL1053','M-PLUS'), true);

console.log('\nSortering: datum, dan uur, dan ploeg');
const {results:sorted} = await db.prepare(
  `SELECT guid FROM matches WHERE seizoen='2627' AND status='actief' AND datum>='2026-08-24'
   ORDER BY datum, uur, thuis_naam`).all();
check('chronologisch', sorted.map(r=>r.guid), ['M-YO','M-PLUS','M-GEEN','M-INACT','M-BETA']);

console.log('\nSortering van officials op achternaam');
const {results:pers} = await db.prepare(
  `SELECT voornaam || ' ' || achternaam AS n FROM users
    ORDER BY achternaam COLLATE NOCASE, voornaam COLLATE NOCASE`).all();
check('hoofdletterongevoelig: kleine v tussen de V-namen', pers.map(r=>r.n),
  ['Ann Aerts','Bert van Geijstelen','Cis Van Meerbeeck','Dirk Willems']);

const {results:fout} = await db.prepare(
  "SELECT achternaam AS n FROM users ORDER BY achternaam").all();
check('zonder NOCASE gaat het mis (bewijs)', fout.map(r=>r.n),
  ['Aerts','Van Meerbeeck','Willems','van Geijstelen']);

console.log(f===0 ? '\n=== ZICHTBAARHEIDSTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f?1:0);
