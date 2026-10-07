/**
 * Tests voor de uitslag: parsen uit de VBL-API, en wegschrijven bij sync.
 */
import { normaliseerUitslag, normaliseerWedstrijd, normaliseerForfait, wedstrijdHash } from '../src/lib/vbl.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

console.log('\n1. normaliseerUitslag: de valkuilen uit de VBL-API');
// 'gespeeld' is 'G', niet het voor de hand liggende 'J'.
check('gespeeld G met uitslag', normaliseerUitslag('G', ' 63- 92'), '63-92');
check('niet gespeeld (N)', normaliseerUitslag('N', ''), null);
check('N met toch een uitslag: nog steeds null', normaliseerUitslag('N', '63-92'), null);
// Opvulspaties op wisselende posities.
check('spaties rond het streepje', normaliseerUitslag('G', '  9-102'), '9-102');
check('geen spaties', normaliseerUitslag('G', '63-92'), '63-92');
check('lege uitslag ondanks gespeeld-vlag', normaliseerUitslag('G', ''), null);
check('ontbrekende vlag maar met uitslag: telt als bewijs', normaliseerUitslag('', '63-92'), '63-92');
check('onzin in plaats van cijfers', normaliseerUitslag('G', 'af-gelast'), null);
check('maar één kant ingevuld', normaliseerUitslag('G', '63-'), null);
check('geen streepje', normaliseerUitslag('G', '6392'), null);
check('null-achtige waarden', normaliseerUitslag(null, null), null);

console.log('\n2. Zit verwerkt in normaliseerWedstrijd');
{
  const rauw = {
    guid: 'BVBL1125G12A2627001', datumString: '12-09-2026', beginTijd: '14.00',
    tTGUID: 'T1', tTNaam: 'Thuis', tUGUID: 'T2', tUNaam: 'Uit',
    gespeeld: 'G', uitslag: ' 63- 92',
  };
  const w = normaliseerWedstrijd(rauw);
  check('uitslag zit in het genormaliseerde object', w.uitslag, '63-92');
}

console.log('\n3. De uitslag zit niet in de hash');
{
  // Bewust: de hash bepaalt wanneer iets als 'gewijzigd' in het logboek komt.
  // Een uitslag die binnenkomt mag daar niet in verschijnen.
  const basis = { datum: '2026-09-12', uur: '14:00', thuisNaam: 'Thuis', uitNaam: 'Uit', locatie: 'Zaal' };
  const zonderUitslag = await wedstrijdHash({ ...basis });
  const metUitslag = await wedstrijdHash({ ...basis, uitslag: '63-92' });
  check('hash negeert de uitslag', zonderUitslag, metUitslag);
}

console.log('\nV40. Forfait uit de uitslag van de bond');
// Letterlijk zoals de API ze in oktober 2026 gaf.
check('BFOR: de bezoekers', normaliseerForfait(' 20-  0  BFOR'), 'uit');
check('AFOR: de thuisploeg', normaliseerForfait('  0- 20  AFOR'), 'thuis');
check('U10-score met forfait', normaliseerForfait('  1-  1  BFOR'), 'uit');
check('dubbel forfait', normaliseerForfait('  0-  0  ABFOR'), 'beide');
check('gewone uitslag: geen forfait', normaliseerForfait(' 51- 74'), null);
check('leeg', normaliseerForfait(''), null);
check('ontbrekend', normaliseerForfait(undefined), null);
check('FOR moet een los woord zijn', normaliseerForfait('FORMULE'), null);
check('kleine letters ook', normaliseerForfait(' 20- 0 bfor'), 'uit');
// De administratieve score is geen uitslag: zo bleef het (terecht) null.
check('forfait geeft geen uitslag', normaliseerUitslag('G', ' 20-  0  BFOR'), null);

const echt = normaliseerWedstrijd({
  guid: 'BVBL26279170INJ1841JFB', wedID: 'INJ1841JFB04', tTGUID: 'BVBL1125J18  4',
  tTNaam: 'AB InBev Leuven Bears J18 D', tUGUID: 'BVBL1447J18  2', tUNaam: 'Hageland United J18 B',
  datumString: '04-10-2026', beginTijd: '13.00', gespeeld: 'G', uitslag: ' 20-  0  BFOR', wedOff: null,
  accGUID: 'BVBL100669', accNaam: 'Stedelijke Sportzaal Wilsele Centrum', pouleNaam: 'U18 Niveau 4 J',
});
check('echte wedstrijd: forfait bezoekers', echt.forfait, 'uit');
check('echte wedstrijd: geen uitslag', echt.uitslag, null);
check('gewone wedstrijd: forfait null',
  normaliseerWedstrijd({ guid: 'X', datumString: '10-10-2026', beginTijd: '14.00', uitslag: ' 63- 92', gespeeld: 'G' }).forfait, null);

console.log(f === 0 ? '\n=== ALLE UITSLAGTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
