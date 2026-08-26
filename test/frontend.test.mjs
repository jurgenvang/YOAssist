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

/** Bestaat er in de HTML een element dat aan deze selector voldoet? */
function bestaatSelector(selector) {
  if (selector.startsWith('#')) {
    return new RegExp(`id="${selector.slice(1)}"`).test(html);
  }
  if (selector.startsWith('.')) {
    // Klassen kunnen ook in een template-literal staan, vandaar de losse match.
    return new RegExp(`class="[^"]*\\b${selector.slice(1)}\\b`).test(html);
  }
  return new RegExp(`<${selector}[\\s>]`).test(html);
}

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

console.log('\n6. Elk "Laden…"-vak wordt ook echt gevuld');
{
  // Deze test bestaat omdat het al twee keer is misgegaan: een sectie krijgt
  // een placeholder, maar de functie die hem vervangt wordt nergens
  // aangeroepen. Het scherm blijft dan eeuwig 'Laden…' tonen zonder fout.
  const placeholders = [...html.matchAll(/id="([\w-]+)"[^>]*>\s*<span class="spinner">/g)]
    .map((m) => m[1]);

  check('er zijn placeholders om te controleren', placeholders.length > 0, true);

  for (const id of placeholders) {
    // Ergens moet iets de inhoud van dat element vervangen.
    const wordtGevuld = new RegExp(`\\$\\('${id}'\\)`).test(html);
    if (!wordtGevuld) {
      f++;
      console.log(`  FOUT ${id}: placeholder wordt nergens vervangen`);
    }
  }
  console.log(`  ok   ${placeholders.length} placeholder(s) worden gevuld`);
}

console.log('\n7. De laadfuncties van het beheerpaneel worden aangeroepen');
{
  const bind = haalFunctie('bindPaneel');

  // Elke functie die een paneelsectie vult, moet in bindPaneel aangeroepen
  // worden. Ontbreekt er één, dan blijft die sectie leeg.
  for (const naam of ['laadGebruikers', 'laadMailConfig', 'laadVrijgeven', 'laadFacturatie', 'laadBackup', 'laadReset']) {
    check(`${naam} wordt aangeroepen`, new RegExp(`${naam}\\(\\)`).test(bind), true);
  }
}

console.log('\n8. De rondleiding wijst naar bestaande elementen');
{
  // Dit is de reden dat de stappen in een apart bestand staan: zo kan een test
  // controleren dat elk doel ook echt in de interface bestaat. Verhuist er ooit
  // een knop, dan valt deze test om in plaats van dat er stil een pijl naar het
  // luchtledige wijst.
  const bron = readFileSync(new URL('../public/rondleiding.js', import.meta.url), 'utf8');
  const window = {};
  // eslint-disable-next-line no-new-func
  new Function('window', bron)(window);
  const stappen = window.YOASSIST_RONDLEIDING;

  check('er zijn stappen', stappen.length > 0, true);

  for (const stap of stappen) {
    check(`doel ${stap.doel} bestaat`, bestaatSelector(stap.doel), true);
    check(`stap ${stap.doel} heeft een titel`, Boolean(stap.titel), true);
    check(`stap ${stap.doel} heeft tekst`, stap.tekst.length > 20, true);
  }

  const adminStappen = stappen.filter((s) => s.enkelAdmin);
  check('er zijn beheerdersstappen', adminStappen.length > 0, true);
  check('en stappen voor iedereen', stappen.length > adminStappen.length, true);
}

console.log('\n9. De rondleiding is oproepbaar en onthoudt zichzelf');
{
  const start = haalFunctie('startRondleiding');
  check('slaat over als er niets aan te wijzen valt', /toast\(/.test(start), true);

  const stop = haalFunctie('stopRondleiding');
  check('onthoudt dat ze gezien is', /localStorage\.setItem/.test(stop), true);

  const misschien = haalFunctie('misschienRondleiding');
  check('start enkel bij de eerste keer', /localStorage\.getItem/.test(misschien), true);

  check('er is een knop om ze opnieuw te tonen', /id="rond-start"/.test(html), true);
  check('en die roept de rondleiding aan', /\$\('rond-start'\)\.onclick/.test(html), true);
}

console.log('\n10. Samenvouwbare secties');
{
  // Elke kop met data-vouw moet gekoppeld worden, anders is ze een dode knop.
  const koppen = [...html.matchAll(/data-vouw="([\w-]+)"/g)].map((m) => m[1]);
  const uniek = [...new Set(koppen)];
  check('er zijn vouwbare secties', uniek.length > 5, true);
  check('geen dubbele sleutels', koppen.length, uniek.length);

  // Secties met een aparte inhoudscontainer moeten die ook echt hebben.
  const metInhoud = [...html.matchAll(/data-vouw-inhoud="([^"]+)"/g)].map((m) => m[1]);
  for (const sleutel of metInhoud) {
    // De sleutel kan een template-uitdrukking zijn; die slaan we over.
    if (sleutel.includes('$')) continue;
    check(`inhoud ${sleutel} heeft een kop`,
      html.includes(`data-vouw="${sleutel}"`), true);
  }

  const koppel = haalFunctie('koppelVouwknoppen');
  check('werkt op beide vormen', /closest\('\.blok'\)/.test(koppel), true);
  check('onthoudt de stand', /isDicht\(/.test(koppel), true);
  check('bedienbaar met het toetsenbord', /onkeydown/.test(koppel), true);
  check('met de juiste rol voor schermlezers', /aria-expanded/.test(koppel), true);

  // Wordt hij ook aangeroepen op elk scherm dat opnieuw tekent?
  for (const fn of ['toonMatches', 'toonOverzicht', 'toonPaneel']) {
    check(`${fn} koppelt de vouwknoppen`,
      /koppelVouwknoppen\(/.test(haalFunctie(fn)), true);
  }
}

console.log('\n11. Het naammenu');
{
  check('de naam is de menuknop', /id="balk-info"[^>]*aria-haspopup="menu"/.test(html), true);
  check('geen losse icoonknoppen meer',
    /id="voorkeur-knop"|id="menu-knop"/.test(html), false);

  const items = [...html.matchAll(/data-menu="(\w+)"/g)].map((m) => m[1]);
  check('drie menu-items', [...new Set(items)].sort(), ['beheer', 'rondleiding', 'voorkeuren']);
  check('beheer staat standaard verborgen',
    /data-menu="beheer" hidden/.test(html), true);

  const zet = haalFunctie('zetNaammenu');
  check('meldt de stand aan schermlezers', /aria-expanded/.test(zet), true);
  check('elders klikken sluit het menu',
    /document\.addEventListener\('click', \(\) => zetNaammenu\(false\)\)/.test(html), true);
}

console.log(f === 0 ? '\n=== ALLE FRONTENDTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
