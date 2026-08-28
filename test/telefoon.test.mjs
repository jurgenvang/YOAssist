/**
 * Tests voor telefoonnummers: omzetten naar het formaat dat WhatsApp verwacht,
 * en leesbaar maken voor op het scherm.
 */
import { naarInternationaal, whatsappLink, belLink, toonNummer, geldigNummer } from '../src/lib/telefoon.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

console.log('\n1. Belgische nummers naar internationaal');
check('met voorloopnul', naarInternationaal('0470123456'), '32470123456');
check('met spaties', naarInternationaal('0470 12 34 56'), '32470123456');
check('met streepjes', naarInternationaal('0470-12-34-56'), '32470123456');
check('met punten', naarInternationaal('0470.12.34.56'), '32470123456');
check('met plus en landcode', naarInternationaal('+32 470 12 34 56'), '32470123456');
check('met dubbele nul', naarInternationaal('0032470123456'), '32470123456');
check('al met landcode zonder plus', naarInternationaal('32470123456'), '32470123456');

console.log('\n2. Buitenlandse nummers blijven staan');
check('Nederlands met plus', naarInternationaal('+31 6 12345678'), '31612345678');
check('Frans met plus', naarInternationaal('+33 6 12 34 56 78'), '33612345678');

console.log('\n3. Onbruikbare invoer');
check('leeg', naarInternationaal(''), null);
check('te kort', naarInternationaal('123'), null);
check('alleen letters', naarInternationaal('bel mij'), null);
check('niets', naarInternationaal(null), null);

console.log('\n4. De WhatsApp-link');
check('volledige link', whatsappLink('0470 12 34 56'), 'https://wa.me/32470123456');
check('geen link zonder nummer', whatsappLink(''), null);
check('geen link bij onzin', whatsappLink('xx'), null);

console.log('\n4b. De bellink');
// Met plus en landcode: een nationaal genoteerd nummer weet niet welk land het
// moet aannemen wanneer iemand in het buitenland zit.
check('bellink met landcode', belLink('0470 12 34 56'), 'tel:+32470123456');
check('buitenlands nummer blijft', belLink('+31 6 12345678'), 'tel:+31612345678');
check('geen link zonder nummer', belLink(''), null);
check('geen link bij onzin', belLink('bel mij'), null);

console.log('\n5. Leesbaar tonen');
check('Belgisch mobiel', toonNummer('0470123456'), '0470 12 34 56');
check('met landcode', toonNummer('32470123456'), '0470 12 34 56');
check('al opgemaakt blijft gelijk', toonNummer('0470 12 34 56'), '0470 12 34 56');
check('leeg blijft leeg', toonNummer(''), '');
// Een vast nummer of buitenlands nummer herkennen we niet; dan liever laten
// staan zoals getikt dan verkeerd opmaken.
check('onbekend patroon blijft zoals getikt', toonNummer('+31 6 12345678'), '+31 6 12345678');

console.log('\n6. Invoercontrole');
check('leeg mag', geldigNummer(''), true);
check('niets mag', geldigNummer(null), true);
check('geldig nummer', geldigNummer('0470123456'), true);
check('onzin niet', geldigNummer('bel mij maar'), false);
check('te kort niet', geldigNummer('12'), false);

console.log(f === 0 ? '\n=== ALLE TELEFOONTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
