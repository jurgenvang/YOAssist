import { normaliseerTeamDomein } from '../src/lib/access.js';

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

console.log(f === 0 ? '\n=== DOMEINTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
