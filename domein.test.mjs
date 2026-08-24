import { normaliseerTeamDomein } from '../src/lib/access.js';
import { categorieUitTeamGuid, wedstrijdbladUrl } from '../src/lib/vbl.js';

let f = 0;
const check = (in_, uit) => {
  const echt = normaliseerTeamDomein(in_);
  if (echt !== uit) { f++; console.log(`  FOUT ${JSON.stringify(in_)} -> ${JSON.stringify(echt)}, verwacht ${JSON.stringify(uit)}`); }
  else console.log(`  ok   ${JSON.stringify(in_)} -> ${echt}`);
};

const doel = 'divine-leaf-1aba.cloudflareaccess.com';
console.log('\nTeamdomein opschonen');
check('divine-leaf-1aba.cloudflareaccess.com', doel);
check('https://divine-leaf-1aba.cloudflareaccess.com', doel);
check('http://divine-leaf-1aba.cloudflareaccess.com', doel);
check('divine-leaf-1aba.cloudflareaccess.com/', doel);
check('https://divine-leaf-1aba.cloudflareaccess.com/', doel);
check('  divine-leaf-1aba.cloudflareaccess.com  ', doel);
check('DIVINE-LEAF-1ABA.cloudflareaccess.com', doel);
check('https://divine-leaf-1aba.cloudflareaccess.com/cdn-cgi/access/certs', doel);
check('', '');
check(null, '');

console.log('\nCategoriecode uit de ploeg-GUID');
const cat = (guid, club, uit) => {
  const echt = categorieUitTeamGuid(guid, club);
  if (echt !== uit) { f++; console.log(`  FOUT ${guid} -> ${echt}, verwacht ${uit}`); }
  else console.log(`  ok   ${guid} -> ${echt}`);
};

// Echte GUID's uit de respons van AB InBev Leuven Bears.
cat('BVBL1125HSE  2', 'BVBL1125', 'HSE');
cat('BVBL1125G08  1', 'BVBL1125', 'G08');
cat('BVBL1125G10  4', 'BVBL1125', 'G10');
cat('BVBL1125J16  1', 'BVBL1125', 'J16');
cat('BVBL1125M19  1', 'BVBL1125', 'M19');
cat('BVBL1125DSE  1', 'BVBL1125', 'DSE');
cat('BVBL1125ROL  2', 'BVBL1125', 'ROL');
cat('BVBL1053J16  1', 'BVBL1053', 'J16');
cat('BVBL1125', 'BVBL1125', null);
cat('BVBL9999J16  1', 'BVBL1125', null);
cat(null, 'BVBL1125', null);

console.log('\nLink naar het wedstrijdblad');
const blad = (guid, uit) => {
  const echt = wedstrijdbladUrl(guid);
  if (echt !== uit) { f++; console.log(`  FOUT ${guid} -> ${echt}`); }
  else console.log(`  ok   ${guid ?? 'null'}`);
};
blad('BVBL26279100BLAJ18PJBC',
     'https://vblweb.wisseq.eu/Home/MatchDetail?wedguid=BVBL26279100BLAJ18PJBC');
blad('BVBL26279100BLAJ16PJDA',
     'https://vblweb.wisseq.eu/Home/MatchDetail?wedguid=BVBL26279100BLAJ16PJDA');
blad('', null);
blad(null, null);

console.log(f === 0 ? '\n=== DOMEIN-, CATEGORIE- EN LINKTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
