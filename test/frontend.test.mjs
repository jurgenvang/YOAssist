/**
 * Test van de herlaadbeveiliging bij een verlopen aanmelding.
 *
 * De functie wordt uit public/index.html gehaald en daar uitgevoerd, niet
 * overgeschreven in deze test. Een kopie zou stilletjes uit de pas lopen met
 * wat er werkelijk wordt uitgeleverd, en dan test je niets.
 */
import { readFileSync } from 'node:fs';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

/**
 * Haalt een functie met haakjes-telling uit de bron.
 *
 * De parameterlijst wordt eerst overgeslagen: een standaardwaarde zoals
 * `opties = {}` bevat accolades die anders als functielichaam meegeteld worden.
 */
function haalFunctie(naam) {
  const start = html.indexOf(`function ${naam}(`);
  if (start === -1) throw new Error(`${naam} niet gevonden in index.html`);

  // Eerst de haakjes van de parameterlijst uitlezen.
  let i = html.indexOf('(', start);
  let ronde = 0;
  for (; i < html.length; i++) {
    if (html[i] === '(') ronde++;
    else if (html[i] === ')') {
      ronde--;
      if (ronde === 0) { i++; break; }
    }
  }

  let diepte = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') diepte++;
    else if (html[j] === '}') {
      diepte--;
      if (diepte === 0) return html.slice(start, j + 1);
    }
  }
  throw new Error(`${naam} niet volledig gevonden`);
}

/** Bouwt de functie met een nagebootste sessionStorage. */
function maakGuard({ werkt = true } = {}) {
  const opslag = new Map();
  const sessionStorage = werkt
    ? {
        getItem: (k) => (opslag.has(k) ? opslag.get(k) : null),
        setItem: (k, v) => opslag.set(k, String(v)),
      }
    : {
        getItem: () => { throw new Error('geblokkeerd'); },
        setItem: () => { throw new Error('geblokkeerd'); },
      };

  const bron = `
    const HERLAAD_SLEUTEL = 'yoassist-herlaad';
    const HERLAAD_VENSTER_MS = 20000;
    ${haalFunctie('magHerladenVoorAanmelding')}
    return magHerladenVoorAanmelding;`;

  // eslint-disable-next-line no-new-func
  return { guard: new Function('sessionStorage', 'Date', bron)(sessionStorage, Date), opslag };
}

console.log('\n1. Eén herlaadbeurt, daarna de rem erop');
{
  const { guard } = maakGuard();
  check('eerste keer mag', guard(), true);
  check('meteen daarna niet meer', guard(), false);
  check('en ook de derde keer niet', guard(), false);
}

console.log('\n2. Na het tijdvenster mag het opnieuw');
{
  const { guard, opslag } = maakGuard();
  guard();
  // Doen alsof de vorige herlaadbeurt lang geleden was.
  opslag.set('yoassist-herlaad', String(Date.now() - 25000));
  check('na 25 seconden mag het weer', guard(), true);
}

console.log('\n3. Net binnen het venster blijft geblokkeerd');
{
  const { guard, opslag } = maakGuard();
  guard();
  opslag.set('yoassist-herlaad', String(Date.now() - 19000));
  check('na 19 seconden nog niet', guard(), false);
}

console.log('\n4. Zonder werkende sessionStorage nooit herladen');
{
  const { guard } = maakGuard({ werkt: false });
  // Geen opslag betekent geen rem; dan is niet herladen veiliger dan een
  // pagina die blijft tollen.
  check('geen automatische herlaadbeurt', guard(), false);
  check('ook niet bij een tweede poging', guard(), false);
}

console.log('\n5. De 401-afhandeling zit echt in api()');
{
  const bronApi = haalFunctie('api');
  check('controleert op status 401', /res\.status === 401/.test(bronApi), true);
  check('gebruikt de beveiliging', /magHerladenVoorAanmelding\(\)/.test(bronApi), true);
  check('herlaadt de pagina', /location\.reload\(\)/.test(bronApi), true);
  check('laat de aanroeper niets afhandelen', /new Promise\(\(\) => \{\}\)/.test(bronApi), true);

  const bronBestand = haalFunctie('haalBestand');
  check('downloads volgen dezelfde weg', /res\.status === 401/.test(bronBestand), true);
}

console.log(f === 0 ? '\n=== ALLE FRONTENDTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
