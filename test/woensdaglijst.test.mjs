/**
 * De woensdaglijst van Basketbal Vlaanderen (V39).
 *
 * Mail en Excel worden hier nagebouwd in de vorm van het echte voorbeeld
 * (Mailchimp, quoted-printable, gecodeerd onderwerp, grijze cellen) — niet het
 * echte bestand zelf: dat bevat persoonsgegevens en hoort niet in de repo.
 *
 * Alle datums rekenen vanaf de eerstvolgende woensdag. Een vaste datum zou
 * ooit voorbij zijn, en dan faalt de test zonder dat er iets veranderde.
 */
import { readFileSync } from 'node:fs';
import { deflateRawSync, crc32 } from 'node:zlib';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { leesMail, adresUit, gecodeerdeWoorden } from '../src/lib/mime.js';
import { pakUit, leesXlsx } from '../src/lib/xlsx.js';
import {
  leesLijst, koppel, lijstDatum, lijstUur, naamSleutel, woensdagVoor, voorbijMoment,
  ontvangMail, woensdagOm14, woensdagTerugval, herkenMail,
} from '../src/lib/woensdaglijst.js';
import { vblOfficials } from '../src/lib/aanduiding.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

// ---- Datums: de eerstvolgende woensdag en haar weekend ---------------------
const vandaagUtc = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
const totWoensdag = ((3 - vandaagUtc.getUTCDay() + 7) % 7) || 7;
const WOENSDAG = new Date(vandaagUtc.getTime() + totWoensdag * 86400000);
const isoDag = (d, n = 0) => new Date(d.getTime() + n * 86400000).toISOString().slice(0, 10);
const ZA = isoDag(WOENSDAG, 3);
const ZO = isoDag(WOENSDAG, 4);
const alsLijst = (iso) => { const [j, m, d] = iso.split('-').map(Number); return `${d}/${m}/${j}`; };
// 10:00 UTC is in Brussel 11 of 12 uur; 13:00 UTC is 14 of 15 uur.
const VOOR_14 = new Date(`${isoDag(WOENSDAG)}T10:00:00Z`);
const NA_14 = new Date(`${isoDag(WOENSDAG)}T13:00:00Z`);

const CLUB = 'BVBL1125';
const LINK = 'https://mcusercontent.com/f68d849bc654ee744db427f33/files/abc-123/Weekend_test.xlsx';

// ---- Een xlsx bouwen -------------------------------------------------------
function zip(bestanden, { opgeslagen = false } = {}) {
  const lokaal = [];
  const centraal = [];
  let offset = 0;
  for (const [naam, inhoud] of Object.entries(bestanden)) {
    const data = Buffer.from(inhoud, 'utf8');
    const gecomprimeerd = opgeslagen ? data : deflateRawSync(data);
    const naamBuf = Buffer.from(naam, 'utf8');
    const kop = Buffer.alloc(30);
    kop.writeUInt32LE(0x04034b50, 0); kop.writeUInt16LE(20, 4); kop.writeUInt16LE(opgeslagen ? 0 : 8, 8);
    kop.writeUInt32LE(crc32(data), 14); kop.writeUInt32LE(gecomprimeerd.length, 18);
    kop.writeUInt32LE(data.length, 22); kop.writeUInt16LE(naamBuf.length, 26);
    lokaal.push(kop, naamBuf, gecomprimeerd);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt16LE(opgeslagen ? 0 : 8, 10); c.writeUInt32LE(crc32(data), 16);
    c.writeUInt32LE(gecomprimeerd.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(naamBuf.length, 28); c.writeUInt32LE(offset, 42);
    centraal.push(c, naamBuf);
    offset += 30 + naamBuf.length + gecomprimeerd.length;
  }
  const cd = Buffer.concat(centraal);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(bestanden).length, 8);
  eocd.writeUInt16LE(Object.keys(bestanden).length, 10); eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokaal, cd, eocd]);
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KOP = ['Code', 'Datum', 'Tijd', 'Niveau/Subniveau', 'Divisie', 'Reeks', 'Thuis ploeg', 'Uit ploeg',
  'Accommodatie', 'Official 1', 'Official 2'];

/**
 * Rijen als { datum, tijd, reeks, thuis, uit, o1, o2 } met o1/o2 = 'grijs' of ''.
 * Stijlen: 0 geen, 1 blauw (kop), 2 wit, 3 grijs, 4 rood (Code-kolom, zoals echt).
 */
function bouwXlsx(rijen, { kop = KOP, rijKleur = 2, opgeslagen = false } = {}) {
  const gedeeld = [];
  const s = (tekst) => { let i = gedeeld.indexOf(tekst); if (i < 0) { i = gedeeld.length; gedeeld.push(tekst); } return i; };
  const kolom = (i) => String.fromCharCode(65 + i);
  const cel = (r, i, waarde, stijl) => (waarde === ''
    ? `<c r="${kolom(i)}${r}" s="${stijl}"/>`
    : `<c r="${kolom(i)}${r}" s="${stijl}" t="s"><v>${s(waarde)}</v></c>`);

  const xmlRijen = [`<row r="1">${kop.map((k, i) => cel(1, i, k, 1)).join('')}</row>`];
  rijen.forEach((w, n) => {
    const r = n + 2;
    const waarden = ['', w.datum, w.tijd, 'Vlaanderen', 'U16 3/4', w.reeks ?? '', w.thuis, w.uit ?? 'Gast', 'Zaal', '', ''];
    const stijlen = waarden.map((_, i) => (i === 0 ? 4 : rijKleur));
    if (w.o1 === 'grijs') stijlen[9] = 3;
    if (w.o2 === 'grijs') stijlen[10] = 3;
    xmlRijen.push(`<row r="${r}">${waarden.map((v, i) => cel(r, i, v, stijlen[i])).join('')}</row>`);
  });

  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Aanduidingen" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst ${ns}>${gedeeld.map((g) => `<si><t>${xmlEsc(g)}</t></si>`).join('')}</sst>`,
    'xl/styles.xml': `<?xml version="1.0"?><styleSheet ${ns}><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF578EBE"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFCCCCCC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7505A"/></patternFill></fill></fills><cellXfs count="5"><xf fillId="0"/><xf fillId="2"/><xf fillId="3"/><xf fillId="4"/><xf fillId="5"/></cellXfs></styleSheet>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet ${ns}><sheetData>${xmlRijen.join('')}</sheetData></worksheet>`,
  }, { opgeslagen });
}

// ---- Een mail bouwen, zoals Mailchimp ze stuurt ----------------------------
function qp(tekst) {
  // Lange regels afbreken met een zachte regelbreuk, net als het origineel.
  return tekst.replace(/=/g, '=3D').split('\n')
    .map((r) => (r.match(/.{1,70}/g) ?? ['']).join('=\n')).join('\n');
}
function bouwMail({ van = 'Basketbal Vlaanderen <info@basketbal.vlaanderen>',
  onderwerp = '=?utf-8?Q?Wedstrijden=20zonder=20officials=20komend=20weekend=20&=20nieuws?=',
  link = LINK } = {}) {
  const tekst = `** Beste official\n\nOverzicht wedstrijden zonder officials (${link ?? 'geen link'})\n\nTot volgende week.`;
  const html = `<p><a href="https://vlaanderen.us3.list-manage.com/track/click?u=1&amp;id=2">Overzicht</a></p>`;
  return [
    `From: ${van}`, 'To: vbl@yoassist.org', `Subject: ${onderwerp}`, 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="_----------=_MCPart_1"', '',
    'This is a multi-part message in MIME format', '',
    '--_----------=_MCPart_1', 'Content-Type: text/plain; charset="utf-8"; format="fixed"',
    'Content-Transfer-Encoding: quoted-printable', '', qp(tekst), '',
    '--_----------=_MCPart_1', 'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable', '', qp(html), '',
    '--_----------=_MCPart_1--', '',
  ].join('\r\n');
}

// ---- De databank ----------------------------------------------------------
function nieuweEnv() {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`
    UPDATE settings SET waarde = 'aanduidingen@club.be' WHERE sleutel = 'mail_afzender';
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'AB InBev Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES
      ('${CLUB}J16  1', '${CLUB}', 'J16 A', 'J16'), ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('plus@club.be', 'Bert',   'Bosmans',        0, 'YO+', '${CLUB}'),
      ('yo@club.be',   'Ann',    'Aerts',          0, 'YO',  '${CLUB}');
  `);
  return { DB: db, ENVIRONMENT: 'development', RESEND_API_KEY: 're_test' };
}

function wed(env, guid, datum, uur, thuis, { off = 0, scope = 0, reden = null, scopeUit = 0, cat = 'J16',
  poule = 'U16 Niveau 3 P', forfait = null, officials = [] } = {}) {
  env.DB.exec(`
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam, datum, uur,
                         poule_naam, cat_code, off_namen, off_aantal, scope, scope_reden, scope_uit, forfait, hash)
    VALUES ('${guid}','2627','${CLUB}','${CLUB}${cat}  1','${thuis}','Gast','${datum}','${uur}',
            '${poule}','${cat}','[]',${off},${scope},${reden ? `'${reden}'` : 'NULL'},${scopeUit},
            ${forfait ? `'${forfait}'` : 'NULL'},'h${guid}')`);
  for (const e of officials) {
    env.DB.exec(`INSERT INTO assignments (match_guid, user_email, toegewezen_door) VALUES ('${guid}','${e}','baas@club.be')`);
  }
}

/** fetch nabootsen: het Excel-bestand, en de mails die Resend zou versturen. */
function zetFetch(xlsx, { status = 200 } = {}) {
  const mails = [];
  globalThis.fetch = async (url, opties) => {
    if (String(url).startsWith('https://mcusercontent.com/')) {
      return { ok: status === 200, status, arrayBuffer: async () => xlsx };
    }
    mails.push(JSON.parse(opties.body));
    return { ok: true, json: async () => ({}) };
  };
  return mails;
}

const rij = async (env, guid) => env.DB.prepare('SELECT scope, scope_reden, bond_officials FROM matches WHERE guid = ?').bind(guid).first();

// ===========================================================================
console.log('\n1. De mail uitlezen');
{
  const m = leesMail(bouwMail());
  check('afzender', adresUit(m.van), 'info@basketbal.vlaanderen');
  check('gecodeerd onderwerp', m.onderwerp, 'Wedstrijden zonder officials komend weekend & nieuws');
  check('twee tekstdelen', m.tekstdelen.map((d) => d.type), ['text/plain', 'text/html']);
  check('link over zachte regelbreuken heen', herkenMail(m), { soort: 'lijst', link: LINK });
  check('base64-woord', gecodeerdeWoorden('=?UTF-8?B?w6l0w6k=?='), 'été');
  check('twee woorden na elkaar', gecodeerdeWoorden('=?utf-8?Q?a?= =?utf-8?Q?b?='), 'ab');
  check('adres zonder naam', adresUit('INFO@Basketbal.Vlaanderen'), 'info@basketbal.vlaanderen');

  const genest = [
    'From: x@y.be', 'Content-Type: multipart/mixed; boundary="A"', '', '--A',
    'Content-Type: multipart/alternative; boundary="B"', '', '--B',
    'Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: base64', '',
    Buffer.from('Héllo daar').toString('base64'), '--B--', '--A--', '',
  ].join('\r\n');
  check('genest multipart met base64', leesMail(genest).tekstdelen[0].tekst, 'Héllo daar');
}

console.log('\n2. Het Excel-bestand uitlezen');
{
  for (const opgeslagen of [false, true]) {
    const xlsx = bouwXlsx([{ datum: '3/10/2026', tijd: '9:00', thuis: 'A & B J16 A', o1: 'grijs' }], { opgeslagen });
    const bestanden = await pakUit(xlsx);
    check(`zip ${opgeslagen ? 'zonder' : 'met'} compressie`, Object.keys(bestanden).includes('xl/styles.xml'), true);
    const r = await leesXlsx(xlsx);
    check('werkblad', r.blad, 'Aanduidingen');
    check('kop', r.rijen[0].map((c) => c.waarde), KOP);
    check('entiteit ontsnapt', r.rijen[1][6].waarde, 'A & B J16 A');
    check('grijze cel gelezen', r.rijen[1][9].kleur, 'FFCCCCCC');
    check('witte cel', r.rijen[1][10].kleur, 'FFFFFFFF');
  }
  let fout = null;
  try { await pakUit(Buffer.from('geen zip')); } catch (e) { fout = e.message; }
  check('geen zip: duidelijke fout', fout, 'Geen geldig zip-bestand.');
}

console.log('\n3. De lijst lezen: kolommen, datums en grijze cellen');
{
  check('datum', lijstDatum('3/10/2026'), '2026-10-03');
  check('datum als Excel-getal', lijstDatum('46298'), '2026-10-03');
  check('onzin-datum', lijstDatum('32/13/2026'), null);
  check('uur', lijstUur('9:00'), '09:00');
  check('uur met punt', lijstUur('16.30'), '16:30');
  check('uur als Excel-fractie', lijstUur('0.375'), '09:00');
  check('uur met seconden', lijstUur('9:00:00'), '09:00');
  check('onzin-uur', lijstUur('9 uur'), null);
  check('naam: hoofdletters en spaties', naamSleutel('  AB  Inbev Leuven Bears G14 B '), naamSleutel('AB InBev Leuven Bears G14 B'));

  const r = await leesXlsx(bouwXlsx([
    { datum: '3/10/2026', tijd: '9:00', thuis: 'Ploeg A', reeks: 'U16 Niveau 4 O' },
    { datum: '3/10/2026', tijd: '11:00', thuis: 'Ploeg B', o1: 'grijs' },
    { datum: '4/10/2026', tijd: '13:00', thuis: 'Ploeg C', o2: 'grijs' },
  ]));
  const { wedstrijden } = leesLijst(r.rijen);
  check('drie wedstrijden', wedstrijden.length, 3);
  check('leeg = 0, grijs = 1', wedstrijden.map((w) => w.officials), [0, 1, 1]);
  check('genormaliseerd', [wedstrijden[0].datum, wedstrijden[0].uur, wedstrijden[0].reeks],
    ['2026-10-03', '09:00', 'U16 Niveau 4 O']);

  // Een hele rij in het grijs is geen 'één official'.
  const grijzeRij = await leesXlsx(bouwXlsx([{ datum: '3/10/2026', tijd: '9:00', thuis: 'X' }], { rijKleur: 3 }));
  check('hele rij gekleurd telt niet', leesLijst(grijzeRij.rijen).wedstrijden[0].officials, 0);

  // Kolommen in een andere volgorde: geen probleem.
  const anders = [...KOP]; [anders[1], anders[2]] = [anders[2], anders[1]];
  const omgewisseld = await leesXlsx(bouwXlsx([{ datum: '9:00', tijd: '3/10/2026', thuis: 'X' }], { kop: anders }));
  check('kolomvolgorde mag wijzigen', leesLijst(omgewisseld.rijen).wedstrijden[0].datum, '2026-10-03');

  // Een kolom die ontbreekt: luid falen.
  const zonder = KOP.map((k) => (k === 'Official 2' ? 'Opmerking' : k));
  let fout = null;
  try { leesLijst((await leesXlsx(bouwXlsx([{ datum: '3/10/2026', tijd: '9:00', thuis: 'X' }], { kop: zonder }))).rijen); }
  catch (e) { fout = e.message; }
  check('ontbrekende kolom: fout met naam', /'official 2'/.test(fout ?? ''), true);

  fout = null;
  try { leesLijst([[{ waarde: 'iets anders', kleur: null }]]); } catch (e) { fout = e.message; }
  check('geen kop: fout', /Thuis ploeg/.test(fout ?? ''), true);
}

console.log('\n4. Wanneer is het woensdag 14 uur voorbij?');
{
  check('woensdag voor zaterdag', woensdagVoor('2026-10-10'), '2026-10-07');
  check('woensdag voor vrijdag', woensdagVoor('2026-10-09'), '2026-10-07');
  check('woensdag voor zondag', woensdagVoor('2026-10-11'), '2026-10-07');
  // Zomertijd: 12:00 UTC = 14 uur. Wintertijd: 13:00 UTC = 14 uur.
  check('zomer 11:59 UTC: nog niet', voorbijMoment('2026-10-10', new Date('2026-10-07T11:59:00Z')), false);
  check('zomer 12:00 UTC: wel', voorbijMoment('2026-10-10', new Date('2026-10-07T12:00:00Z')), true);
  check('winter 12:30 UTC: nog niet', voorbijMoment('2026-12-05', new Date('2026-12-02T12:30:00Z')), false);
  check('winter 13:00 UTC: wel', voorbijMoment('2026-12-05', new Date('2026-12-02T13:00:00Z')), true);
  check('donderdag: zeker', voorbijMoment('2026-10-10', new Date('2026-10-08T06:00:00Z')), true);
}

console.log('\n5. Koppelen aan de eigen thuiswedstrijden');
{
  const eigen = [
    { guid: 'M1', datum: ZA, uur: '09:00', thuis_naam: 'AB InBev Leuven Bears J16 A', poule_naam: 'U16 Niveau 3 P' },
    { guid: 'M2', datum: ZA, uur: '11:00', thuis_naam: 'AB Inbev Leuven Bears G14 B', poule_naam: 'U14 Niveau 3 K' },
  ];
  const lijst = [
    { datum: ZA, uur: '09:00', thuis: 'AB InBev Leuven Bears J16 A', reeks: 'U16 Niveau 3 P', officials: 0 },
    { datum: ZA, uur: '11:00', thuis: 'AB INBEV Leuven Bears G14 B', reeks: 'U14 Niveau 4 A', officials: 1 },
    { datum: ZA, uur: '14:00', thuis: 'Hageland United J18 A', uit: 'AB InBev Leuven Bears J18 B', officials: 0 },
    { datum: ZO, uur: '15:00', thuis: 'AB InBev Leuven Bears J16 A', officials: 0 },
  ];
  const r = koppel(lijst, eigen);
  check('eigen thuiswedstrijden gekoppeld, ook met andere hoofdletters', r.gekoppeld,
    [{ guid: 'M1', officials: 0 }, { guid: 'M2', officials: 1 }]);
  check('uitwedstrijd (andere thuisploeg) doet niet mee', r.gekoppeld.length + r.nietGekoppeld.length, 3);
  check('eigen ploeg op een onbekend uur: gemeld', r.nietGekoppeld.map((x) => x.uur), ['15:00']);
  check('afwijkende reeks gemeld', r.reeksAfwijking.map((x) => [x.lijst, x.app]), [['U14 Niveau 4 A', 'U14 Niveau 3 K']]);
}

// Een volledige week, gedeeld door de volgende blokken.
function zetWeekKlaar(env) {
  const B = 'AB InBev Leuven Bears';
  wed(env, 'IN_LEEG', ZA, '09:00', `${B} J16 A`);                               // in de lijst, 0 officials
  wed(env, 'IN_GRIJS', ZA, '11:00', `${B} J16 B`);                              // in de lijst, 1 official
  wed(env, 'IN_API2', ZA, '13:00', `${B} J16 C`, { off: 2 });                   // in de lijst, API toont 2
  wed(env, 'IN_UIT', ZA, '15:00', `${B} J16 D`, { scopeUit: 1 });               // in de lijst, beheerder haalde ze eruit
  wed(env, 'NIET_API0', ZO, '09:00', `${B} J18 A`);                             // niet in de lijst, API 0
  wed(env, 'NIET_AUTO', ZO, '11:00', `${B} J18 B`, { scope: 1, reden: 'woensdag' });          // eerder automatisch erin
  wed(env, 'NIET_BEZET', ZO, '13:00', `${B} J18 C`, { scope: 1, reden: 'woensdag', officials: ['plus@club.be'] });
  wed(env, 'NIET_ADMIN', ZO, '15:00', `${B} J18 D`, { scope: 1, reden: 'admin' });            // beheerder zette ze erin
  wed(env, 'U12', ZA, '10:00', `${B} G12 A`, { cat: 'G12', scope: 1, reden: 'auto' });        // U12 doet niet mee
  wed(env, 'FORFAIT', ZO, '17:00', `${B} J18 E`, { forfait: 'uit' });                         // forfait doet niet mee
  wed(env, 'G08', ZO, '09:30', `${B} G08 A`, { cat: 'G08' });                                 // onbekende categorie
  return bouwXlsx([
    { datum: alsLijst(ZA), tijd: '9:00', thuis: `${B} J16 A`, reeks: 'U16 Niveau 3 P' },
    { datum: alsLijst(ZA), tijd: '11:00', thuis: `${B} J16 B`, o1: 'grijs' },
    { datum: alsLijst(ZA), tijd: '13:00', thuis: `${B} J16 C` },
    { datum: alsLijst(ZA), tijd: '15:00', thuis: `${B} J16 D` },
    { datum: alsLijst(ZO), tijd: '16:00', thuis: `${B} J16 A` },                // eigen ploeg, onbekend uur
    { datum: alsLijst(ZA), tijd: '14:00', thuis: 'Hageland United J18 A', uit: `${B} J18 B` },
    { datum: alsLijst(ZO), tijd: '10:00', thuis: 'Andere Club U16 A' },
  ]);
}

console.log('\n6. Vóór 14 uur ontvangen, om 14 uur verwerkt');
{
  const env = nieuweEnv();
  const mails = zetFetch(zetWeekKlaar(env));

  const r = await ontvangMail(env, bouwMail(), { nu: VOOR_14 });
  check('bewaard, nog niet verwerkt', r.soort, 'ontvangen');
  check('nog niets in de lijst gezet', (await rij(env, 'IN_LEEG')).scope, 0);
  check('nog geen mails', mails.length, 0);

  const om14 = await woensdagOm14(env, new Date(`${isoDag(WOENSDAG)}T12:00:00Z`));
  check('om 14 uur verwerkt', om14.soort, 'verwerkt');
  const v = om14.resultaat;

  check('in de lijst: erin gezet', [(await rij(env, 'IN_LEEG')).scope, (await rij(env, 'IN_LEEG')).scope_reden], [1, 'woensdag']);
  check('nog nodig volgens de lijst', v.toegevoegd.map((w) => [w.guid, w.nogNodig]),
    [['IN_LEEG', 2], ['IN_GRIJS', 1], ['IN_API2', 0]]);
  check('bond-officials bewaard', [(await rij(env, 'IN_LEEG')).bond_officials, (await rij(env, 'IN_GRIJS')).bond_officials], [0, 1]);
  check('door de beheerder eruit gehaald: blijft eruit', (await rij(env, 'IN_UIT')).scope, 0);

  check('automatisch erin, niet in de lijst, niemand op: eruit', (await rij(env, 'NIET_AUTO')).scope, 0);
  check('met een aanduiding: blijft staan', (await rij(env, 'NIET_BEZET')).scope, 1);
  check('door een beheerder erin gezet: blijft', (await rij(env, 'NIET_ADMIN')).scope, 1);
  check('niet in de lijst: bond voorziet twee', (await rij(env, 'NIET_API0')).bond_officials, 2);
  check('U12, forfait en onbekende categorie ongemoeid',
    [(await rij(env, 'U12')).bond_officials, (await rij(env, 'FORFAIT')).bond_officials, (await rij(env, 'G08')).bond_officials],
    [null, null, null]);

  check('uit de lijst gehaald', v.uitGehaald.map((w) => w.guid), ['NIET_AUTO']);
  check('laten staan', v.blijftStaan.map((w) => w.guid), ['NIET_BEZET']);
  check('afwijking: API leeg, bond voorzien', v.afwijkingA.map((w) => w.guid), ['NIET_API0', 'NIET_AUTO', 'NIET_BEZET', 'NIET_ADMIN']);
  check('afwijking: in de lijst, API toont al refs', v.afwijkingB.map((w) => [w.guid, w.api, w.bond]), [['IN_API2', 2, 0]]);
  check('niet te koppelen', v.nietGekoppeld.map((x) => x.uur), ['16:00']);

  const naarPlus = mails.find((m) => m.to === 'plus@club.be');
  check('YO+ krijgt de gewone mail', /J16 A/.test(naarPlus?.text ?? ''), true);
  check('niet de afwijkingen', /afwijk|API/i.test(naarPlus?.text ?? ''), false);
  const naarBaas = mails.filter((m) => m.to === 'baas@club.be').map((m) => m.text).join('\n');
  check('beheerder: overzicht met afwijkingen', /nog geen naam zichtbaar in de API/.test(naarBaas), true);
  check('beheerder: wat bleef staan', /Laten staan/.test(naarBaas), true);
  check('de gewone YO krijgt niets', mails.some((m) => m.to === 'yo@club.be'), false);

  const opnieuw = await woensdagOm14(env, new Date(`${isoDag(WOENSDAG)}T12:00:00Z`));
  check('tweede keer: niets meer te doen', opnieuw.soort, 'al-verwerkt');

  // Het overzicht rekent met wat de bond voorziet.
  const o = await worker.fetch(new Request('http://localhost/api/admin/overzicht'), { ...env, DEV_EMAIL: 'baas@club.be' }, {});
  const kaarten = (await o.json()).wedstrijden;
  check('cluboverzicht: grijs = nog één nodig', kaarten.find((w) => w.guid === 'IN_GRIJS').nodig, 1);
  check('cluboverzicht: niet in de lijst = niemand nodig', kaarten.find((w) => w.guid === 'NIET_BEZET').nodig, 0);
  check('cluboverzicht: bond-officials mee', kaarten.find((w) => w.guid === 'NIET_BEZET').bondOfficials, 2);
}

console.log('\n7. Na 14 uur ontvangen: meteen verwerken');
{
  const env = nieuweEnv();
  zetFetch(zetWeekKlaar(env));
  const r = await ontvangMail(env, bouwMail(), { nu: NA_14 });
  check('meteen verwerkt', r.soort, 'verwerkt');
  check('in de lijst gezet', (await rij(env, 'IN_LEEG')).scope, 1);
  const dubbel = await ontvangMail(env, bouwMail(), { nu: NA_14 });
  check('tweede exemplaar (doorgestuurd) genegeerd', dubbel.soort, 'dubbel');
  check('maar wel bijgehouden', (await env.DB.prepare("SELECT COUNT(*) AS n FROM vbl_lijsten WHERE status = 'dubbel'").first()).n, 1);
}

console.log('\n8. Geen lijst om 14 uur, terugval om 20 uur');
{
  const env = nieuweEnv();
  const mails = zetFetch(null);
  wed(env, 'API0', ZA, '09:00', 'AB InBev Leuven Bears J16 A');

  const om14 = await woensdagOm14(env, new Date(`${isoDag(WOENSDAG)}T12:00:00Z`));
  check('om 14 uur: niet binnen', om14.soort, 'niet-binnen');
  check('niets in de lijst gezet', (await rij(env, 'API0')).scope, 0);
  check('beheerder gewaarschuwd', mails.some((m) => m.to === 'baas@club.be' && /nog niet binnen/.test(m.subject)), true);
  check('YO+ niet', mails.some((m) => m.to === 'plus@club.be'), false);

  const om20 = await woensdagTerugval(env, new Date(`${isoDag(WOENSDAG)}T18:00:00Z`));
  check('om 20 uur: terugval op de API', om20.soort, 'terugval');
  check('met de API in de lijst gezet', [(await rij(env, 'API0')).scope, (await rij(env, 'API0')).scope_reden], [1, 'woensdag']);
  check('YO+ krijgt nu de gewone mail', mails.some((m) => m.to === 'plus@club.be'), true);
  check('beheerder hoort van de terugval', mails.some((m) => m.to === 'baas@club.be' && /met de API/.test(m.subject)), true);

  // De lijst komt toch nog, donderdag: zet recht.
  const B = 'AB InBev Leuven Bears';
  zetFetch(bouwXlsx([{ datum: alsLijst(ZO), tijd: '9:00', thuis: `${B} J18 Z` }]));
  const laat = await ontvangMail(env, bouwMail(), { nu: new Date(`${isoDag(WOENSDAG, 1)}T08:00:00Z`) });
  check('later toch verwerkt', laat.soort, 'verwerkt');
  check('en zet recht: de API-wedstrijd eruit (niet in de lijst, niemand op)', (await rij(env, 'API0')).scope, 0);

  const env2 = nieuweEnv();
  zetFetch(zetWeekKlaar(env2));
  await ontvangMail(env2, bouwMail(), { nu: VOOR_14 });
  check('met lijst: geen terugval nodig', (await woensdagTerugval(env2, new Date(`${isoDag(WOENSDAG)}T18:00:00Z`))).soort, 'niet-nodig');
}

console.log('\n9. Wat geen woensdaglijst is, of niet te lezen');
{
  const env = nieuweEnv();
  let mails = zetFetch(bouwXlsx([{ datum: alsLijst(ZA), tijd: '9:00', thuis: 'X' }]));
  check('andere afzender genegeerd',
    (await ontvangMail(env, bouwMail({ van: 'Vervalst <info@basketbal.vlaanderen.evil.com>' }), { nu: VOOR_14 })).soort, 'onbekend');
  check('andere nieuwsbrief van de bond genegeerd',
    (await ontvangMail(env, bouwMail({ onderwerp: 'Nieuws over opleidingen' }), { nu: VOOR_14 })).soort, 'andere-nieuwsbrief');
  check('daarover geen mails', mails.length, 0);

  const zonderLink = await ontvangMail(env, bouwMail({ link: null }), { nu: VOOR_14 });
  check('lijstmail zonder link: fout', zonderLink.soort, 'fout');
  check('beheerder gewaarschuwd', mails.some((m) => m.to === 'baas@club.be' && /kon niet verwerkt/.test(m.subject)), true);

  zetFetch(null, { status: 404 });
  check('bestand niet op te halen: fout', /HTTP 404/.test((await ontvangMail(env, bouwMail(), { nu: VOOR_14 })).reden), true);

  zetFetch(bouwXlsx([{ datum: alsLijst(ZA), tijd: '9:00', thuis: 'X' }], { kop: KOP.map((k) => (k === 'Tijd' ? 'Uur' : k)) }));
  check('andere kolommen: fout', /'tijd'/.test((await ontvangMail(env, bouwMail(), { nu: VOOR_14 })).reden), true);

  zetFetch(bouwXlsx([{ datum: '3/10/2020', tijd: '9:00', thuis: 'X' }]));
  check('verouderde lijst: fout', /voorbij/.test((await ontvangMail(env, bouwMail(), { nu: VOOR_14 })).reden), true);

  check('alles bijgehouden als fout',
    (await env.DB.prepare("SELECT COUNT(*) AS n FROM vbl_lijsten WHERE status = 'fout'").first()).n, 4);

  // Een fout telt niet als 'binnen': om 14 uur volgt de waarschuwing toch.
  mails = zetFetch(null);
  check('na een fout: om 14 uur niet binnen', (await woensdagOm14(env, new Date(`${isoDag(WOENSDAG)}T12:00:00Z`))).soort, 'niet-binnen');
}

console.log('\n10. Gmail vraagt een bevestiging om door te sturen');
{
  const env = nieuweEnv();
  const mails = zetFetch(null);
  const raw = [
    'From: Gmail Team <forwarding-noreply@google.com>', 'Subject: (#123456) Gmail Forwarding Confirmation',
    'Content-Type: text/plain; charset="UTF-8"', '',
    'Bevestigingscode: 123456. Klik op https://mail.google.com/mail/vf-abc om te bevestigen.', '',
  ].join('\r\n');
  const r = await ontvangMail(env, raw, { naar: 'vbl@yoassist.org', nu: VOOR_14 });
  check('herkend', r.soort, 'gmail-bevestiging');
  const naarBaas = mails.find((m) => m.to === 'baas@club.be');
  check('naar de beheerders, met de code', /123456/.test(naarBaas?.text ?? ''), true);
  check('en de link', /mail\.google\.com\/mail\/vf-abc/.test(naarBaas?.text ?? ''), true);
  check('niet naar anderen', mails.some((m) => m.to !== 'baas@club.be'), false);
}

console.log('\n11. De Worker-ingang voor mail weigert nooit');
{
  const env = nieuweEnv();
  zetFetch(null);
  const bericht = (tekst) => ({
    from: 'iemand@ergens.be', to: 'vbl@yoassist.org',
    raw: new Blob([tekst]).stream(),
    setReject: () => { throw new Error('mag niet geweigerd worden'); },
  });
  let fout = null;
  try {
    await worker.email(bericht('totaal geen mail \u0000\u0001'), env, {});
    await worker.email(bericht(bouwMail({ van: 'x@y.be' })), env, {});
  } catch (e) { fout = e.message; }
  check('geen fout naar buiten', fout, null);
  check('wel gelogd', (await env.DB.prepare("SELECT COUNT(*) AS n FROM logboek WHERE soort = 'woensdaglijst'").first()).n >= 1, true);
}

console.log('\n12. Status bij Beheer');
{
  const env = nieuweEnv();
  zetFetch(zetWeekKlaar(env));
  await ontvangMail(env, bouwMail(), { nu: VOOR_14 });
  const vraag = (alsWie) => worker.fetch(new Request('http://localhost/api/admin/woensdaglijst'), { ...env, DEV_EMAIL: alsWie }, {});
  const r = await (await vraag('baas@club.be')).json();
  check('laatste lijst getoond', [r.lijsten[0].status, r.lijsten[0].van, r.lijsten[0].tot], ['ontvangen', ZA, ZO]);
  check('eigen en totaal', [r.lijsten[0].aantalEigen, r.lijsten[0].aantalRijen], [4, 7]);
  check('niet te koppelen geteld', r.lijsten[0].nietGekoppeld, 1);
  check('enkel voor beheerders', (await vraag('plus@club.be')).status, 403);
}

console.log('\n13. vblOfficials: het hoogste van API en lijst');
{
  check('geen lijst', vblOfficials(1, null), 1);
  check('lijst zegt meer', vblOfficials(0, 2), 2);
  check('API zegt meer: een concrete naam telt', vblOfficials(2, 0), 2);
}

console.log(f === 0 ? '\n=== ALLE WOENSDAGLIJSTTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
