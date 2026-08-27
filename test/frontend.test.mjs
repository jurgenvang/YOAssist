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
  for (const naam of ['laadGebruikers', 'laadMailConfig', 'laadVrijgeven', 'laadOntvangers', 'laadBackup', 'laadReset']) {
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
  const reeksen = window.YOASSIST_RONDLEIDING;

  check('twee reeksen', Object.keys(reeksen).sort(), ['beheerder', 'official']);
  check('official heeft stappen', reeksen.official.length > 0, true);
  check('beheerder heeft stappen', reeksen.beheerder.length > 0, true);

  for (const [naam, stappen] of Object.entries(reeksen)) {
    for (const stap of stappen) {
      check(`${naam}: doel ${stap.doel} bestaat`, bestaatSelector(stap.doel), true);
      check(`${naam}: ${stap.doel} heeft een titel`, Boolean(stap.titel), true);
      check(`${naam}: ${stap.doel} heeft tekst`, stap.tekst.length > 20, true);
    }
  }

  // De officialreeks moet uitleggen dat beschikbaar zetten geen aanduiding is;
  // dat is de meest waarschijnlijke misvatting bij een nieuwe gebruiker.
  const officialTekst = reeksen.official.map((s) => s.titel + ' ' + s.tekst).join(' ');
  check('legt uit dat beschikbaar geen aanduiding is',
    /geen aanduiding|niet dat je moet komen/.test(officialTekst), true);
  check('vraagt ook om nee te antwoorden', /ook als het nee is/.test(officialTekst), true);
  check('vermeldt een probleem melden', /meld dat dan/.test(officialTekst), true);
}

console.log('\n9. De rondleiding is oproepbaar en onthoudt zichzelf');
{
  const start = haalFunctie('startRondleiding');
  check('slaat over als er niets aan te wijzen valt', /toast\(/.test(start), true);

  const stop = haalFunctie('stopRondleiding');
  check('onthoudt dat ze gezien is', /localStorage\.setItem/.test(stop), true);

  const misschien = haalFunctie('misschienRondleiding');
  check('start enkel bij de eerste keer', /localStorage\.getItem/.test(misschien), true);
  check('niet bij een lege lijst', /staat\.matches\.length === 0/.test(misschien), true);

  const stappenFn = haalFunctie('rondStappen');
  check('beheerder krijgt beide reeksen', /'beide'/.test(stappenFn), true);
  check('en slaat onzichtbare elementen over', /offsetParent/.test(stappenFn), true);

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
  check('acht menu-items', [...new Set(items)].sort(),
    ['alsyo', 'beheer', 'clubgeld', 'handleiding', 'over', 'rondleiding',
     'vergoeding', 'voorkeuren']);

  // Beheer hoort bovenaan: dat is wat een beheerder het vaakst nodig heeft.
  check('Beheer staat eerst', items[0], 'beheer');
  check('daarna Vergoedingen Club', items[1], 'clubgeld');
  check('dan Mijn vergoeding', items[2], 'vergoeding');
  check('dan Mijn voorkeuren', items[3], 'voorkeuren');
  check('hoofdletter in Vergoedingen Club', /Vergoedingen Club</.test(html), true);

  // De kijkstand mag nooit iets toevoegen, enkel wegnemen.
  const kijk = haalFunctie('pasTabbalkToe');
  check('kijkstand verbergt de beheerderstabbladen', /kijktAlsYo\(\)/.test(kijk), true);
  check('er is een balk die het toont', /id="kijkbalk"/.test(html), true);
  check('en een knop om terug te gaan', /id="kijk-terug"/.test(html), true);
  check('beheer staat standaard verborgen',
    /data-menu="beheer" hidden/.test(html), true);

  const zet = haalFunctie('zetNaammenu');
  check('meldt de stand aan schermlezers', /aria-expanded/.test(zet), true);
  check('elders klikken sluit het menu',
    /document\.addEventListener\('click', \(\) => zetNaammenu\(false\)\)/.test(html), true);
}

console.log('\n12. Icoon en manifest');
{
  // Zonder apple-touch-icon maakt Safari bij 'Zet op beginscherm' zelf een
  // schermafbeelding. Dat is precies wat we wilden vermijden.
  check('apple-touch-icon aanwezig', /rel="apple-touch-icon"/.test(html), true);
  check('manifest gekoppeld', /rel="manifest"/.test(html), true);
  check('favicon aanwezig', /rel="icon"/.test(html), true);
  check('titel op het beginscherm', /apple-mobile-web-app-title/.test(html), true);

  const manifest = JSON.parse(
    readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8'));
  check('naam', manifest.name, 'YOAssist');
  check('opent als app', manifest.display, 'standalone');

  const maten = manifest.icons.map((i) => i.sizes).sort();
  check('192 en 512 aanwezig', maten.includes('192x192') && maten.includes('512x512'), true);
  check('maskable variant voor Android',
    manifest.icons.some((i) => i.purpose === 'maskable'), true);

  // Elk bestand waarnaar het manifest verwijst, moet er ook zijn.
  for (const icoon of manifest.icons) {
    const pad = new URL('../public' + icoon.src, import.meta.url);
    let bestaat = true;
    try { readFileSync(pad); } catch { bestaat = false; }
    check(`${icoon.src} bestaat`, bestaat, true);
  }
}

console.log('\n13. Rondleiding komt door het menu en de meldingen');
{
  const bron = readFileSync(new URL('../public/rondleiding.js', import.meta.url), 'utf8');
  const window = {};
  // eslint-disable-next-line no-new-func
  new Function('window', bron)(window);
  const reeksen = window.YOASSIST_RONDLEIDING;

  const official = reeksen.official;
  check('een stap opent het naammenu', official.some((s) => s.opent === 'menu'), true);
  check('een stap opent de voorkeuren', official.some((s) => s.opent === 'voorkeuren'), true);
  check('meldingen worden aangewezen',
    official.some((s) => s.doel.includes('data-voorkeur="push"')), true);
  check('met de iPhone-uitleg erbij',
    official.some((s) => /beginscherm/.test(s.tekst)), true);
  check('herinneringen ook',
    official.some((s) => s.doel.includes('herinnerAvond')), true);

  const beheer = reeksen.beheerder;
  check('beheer wordt aangewezen', beheer.some((s) => s.doel.includes('data-menu="beheer"')), true);
  check('vergoedingen ook', beheer.some((s) => s.doel.includes('clubgeld')), true);
  check('kijken als official ook', beheer.some((s) => s.doel.includes('alsyo')), true);

  // De motor moet die stappen ook echt kunnen openen.
  const stap = haalFunctie('toonRondStap');
  check('opent het menu', /stap\.opent === 'menu'/.test(stap), true);
  check('opent de voorkeuren', /stap\.opent === 'voorkeuren'/.test(stap), true);

  const stappenFn = haalFunctie('rondStappen');
  check('zulke stappen worden niet weggefilterd', /if \(stap\.opent\) return/.test(stappenFn), true);

  const stopFn = haalFunctie('stopRondleiding');
  check('en alles gaat weer dicht bij het stoppen',
    /zetNaammenu\(false\)/.test(stopFn) && /sluitVoorkeuren\(\)/.test(stopFn), true);
}

console.log('\n14. Licentie in de app');
{
  check('kennisgeving met copyright', /Copyright © 2026/.test(html), true);
  check('EUPL-1.2 vermeld', /EUPL-1\.2/.test(html), true);
  check('wat de licentie wel en niet dekt', /class="dekt"/.test(html), true);
  check('geen garantie, geen aansprakelijkheid',
    /Geen garantie, geen aansprakelijkheid/.test(html), true);
  check('copyleft uitgelegd', /Copyleft/.test(html), true);
  check('link naar de volledige tekst', /joinup\.ec\.europa\.eu/.test(html), true);
}

console.log('\n15. Het aanduidingenscherm');
{
  // De rand vertelt in één blik waar je staat. Aangeduid wint van beschikbaar,
  // want dat is de eindtoestand.
  check('rood bij niet beschikbaar',
    /\.wed\[data-status="nee"\] \{ border-left-color: var\(--rood\)/.test(html), true);
  check('geel bij beschikbaar',
    /\.wed\[data-status="ja"\]\s+\{ border-left-color: var\(--amber\)/.test(html), true);
  check('groen bij aangeduid',
    /\.wed\[data-toegewezen="1"\] \{ border-left-color: var\(--groen\)/.test(html), true);

  check('locatie is een kaartlink', /google\.com\/maps\/search/.test(html), true);
  check('met de locatie erin', /encodeURIComponent\(m\.locatie/.test(html), true);

  check('geen Refs-label meer', /<span class="ov-label">Refs<\/span>/.test(html), false);
  check('plaatsen staan onder elkaar',
    /\.wed-refs \{[^}]*flex-direction: column/.test(html), true);

  check('aanwezig op het terrein', /Aanwezig op het terrein om/.test(html), true);
  check('niet meer ter plaatse', /ter plaatse/.test(html), false);

  check('aangeduid op groen', /\.aangeduid-merk \{[^}]*background: var\(--groen\)/.test(html), true);
  check('wedstrijdblad bij de aanduiding', /class="mini" href="\$\{tekst\(m\.wedstrijdblad\)/.test(html), true);
  check('naast probleem melden', /vergrendeld-knoppen/.test(html), true);
  // Niet twee keer tonen: staat het bij de aanduiding, dan hoort het niet ook
  // nog in de metaregel.
  check('niet dubbel getoond', /m\.wedstrijdblad && !m\.toegewezen/.test(html), true);
}

console.log(f === 0 ? '\n=== ALLE FRONTENDTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
