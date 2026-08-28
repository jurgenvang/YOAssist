/**
 * Tests voor het weekendvenster. De randgevallen zitten in de dag van de week:
 * een venster mag nooit een zaterdag tonen zonder haar zondag.
 */
import { weekendVenster, vensterLabel } from '../src/lib/venster.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

// September 2026: 7 = maandag, 12 = zaterdag, 13 = zondag, 19/20 = volgend weekend
const dag = (d) => new Date(`2026-09-${String(d).padStart(2, '0')}T12:00:00Z`);

console.log('\n1. Vanaf een doordeweekse dag');
{
  const v = weekendVenster(dag(7));           // maandag
  check('start vandaag', v.van, '2026-09-07');
  check('eindigt op de tweede zondag', v.tot, '2026-09-20');
  check('twee volledige weekends', v.weekends,
    [{ zaterdag: '2026-09-12', zondag: '2026-09-13' },
     { zaterdag: '2026-09-19', zondag: '2026-09-20' }]);
}

console.log('\n2. Vanaf een zaterdag telt dat weekend mee');
{
  const v = weekendVenster(dag(12));
  check('dit weekend is het eerste', v.weekends[0], { zaterdag: '2026-09-12', zondag: '2026-09-13' });
  check('tot en met volgende zondag', v.tot, '2026-09-20');
}

console.log('\n3. Vanaf een zondag telt de lopende dag nog mee');
{
  const v = weekendVenster(dag(13));
  check('vandaag is nog het eerste weekend', v.weekends[0].zondag, '2026-09-13');
  check('tweede weekend erna', v.weekends[1], { zaterdag: '2026-09-19', zondag: '2026-09-20' });
}

console.log('\n4. Nooit een zaterdag zonder zondag');
{
  // Voor elke dag van een hele week moet elk weekend in het venster compleet zijn.
  for (let d = 7; d <= 13; d++) {
    const v = weekendVenster(dag(d));
    const compleet = v.weekends.every((w) => {
      const zat = new Date(w.zaterdag + 'T00:00:00Z');
      const zon = new Date(w.zondag + 'T00:00:00Z');
      return zat.getUTCDay() === 6 && zon.getUTCDay() === 0 && zon - zat === 86400000;
    });
    if (!compleet) { f++; console.log(`  FOUT venster vanaf ${d} sep is niet compleet`); }
  }
  console.log('  ok   elk weekend in het venster is zaterdag + zondag');
}

console.log('\n5. Aantal weekends instelbaar');
{
  check('één weekend', weekendVenster(dag(7), 1).tot, '2026-09-13');
  check('vier weekends', weekendVenster(dag(7), 4).weekends.length, 4);
  check('vier weekends eindigt juist', weekendVenster(dag(7), 4).tot, '2026-10-04');
}

console.log('\n6. Over een maandgrens');
{
  // 26/27 september en 3/4 oktober
  const v = weekendVenster(new Date('2026-09-21T12:00:00Z'));
  check('weekends over de maandgrens', v.weekends,
    [{ zaterdag: '2026-09-26', zondag: '2026-09-27' },
     { zaterdag: '2026-10-03', zondag: '2026-10-04' }]);
}

console.log('\n7. Leesbaar label');
{
  check('zelfde maand', vensterLabel(weekendVenster(dag(7))), '12–13 en 19–20 sep');
  check('over de maandgrens',
    vensterLabel(weekendVenster(new Date('2026-09-21T12:00:00Z'))), '26–27 en 3–4 okt');
  check('één weekend', vensterLabel(weekendVenster(dag(7), 1)), '12–13 sep');
}

console.log('\n8. Jaargrens');
{
  // 26/27 december 2026 (zaterdag/zondag) en 2/3 januari 2027
  const v = weekendVenster(new Date('2026-12-21T12:00:00Z'));
  check('over de jaargrens', v.weekends,
    [{ zaterdag: '2026-12-26', zondag: '2026-12-27' },
     { zaterdag: '2027-01-02', zondag: '2027-01-03' }]);
}

console.log(f === 0 ? '\n=== ALLE VENSTERTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
