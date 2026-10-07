/**
 * De woensdaglijst van Basketbal Vlaanderen (V39).
 *
 * Elke woensdag, normaal rond 13:35, stuurt info@basketbal.vlaanderen een
 * nieuwsbrief met een Excel-bestand: de wedstrijden van het komende weekend
 * waar de bond geen of maar één official kon aanduiden. Die lijst heeft
 * voorrang op de API. Wat er niet in staat, heeft volgens de bond twee
 * officials — ook als de API nog niemand toont, want aanduidingen zijn daar
 * niet altijd meteen zichtbaar.
 *
 * Verloop:
 *  - De mail komt binnen (`ontvangMail`): afzender en onderwerp nakijken, het
 *    Excel-bestand ophalen en uitlezen, de eigen thuiswedstrijden koppelen,
 *    bewaren. Is het al woensdag 14 uur voorbij, dan meteen verwerken.
 *  - Woensdag 14 uur (`woensdagOm14`): de lijst van deze week verwerken, of de
 *    beheerders verwittigen dat ze nog niet binnen is.
 *  - Woensdag 20 uur (`woensdagTerugval`): nog altijd geen lijst, dan de oude
 *    woensdagregel met de API. Komt de lijst daarna toch, dan zet ze recht.
 *
 * Alles hangt aan dingen die de bond zonder waarschuwing kan wijzigen. Elke
 * onverwachte vorm faalt daarom luid, met een melding aan de beheerders, en
 * nooit stil.
 */

import { leesMail, adresUit } from './mime.js';
import { leesXlsx } from './xlsx.js';
import { log } from './logboek.js';
import { aantalNodig } from './aanduiding.js';
import { komendWeekend, pasWoensdagregelToe } from './woensdag.js';
import {
  templateWoensdagregel, templateWoensdaglijstBeheer, templateLijstNietBinnen,
  templateTerugval, templateLijstFout,
} from './mailer.js';
import { verwittigAllen } from './verwittigen.js';

export const AFZENDER = 'info@basketbal.vlaanderen';
const GMAIL_BEVESTIGING = 'forwarding-noreply@google.com';
const ONDERWERP = /zonder officials/i;
// Bevestigingen die een mens moet aanklikken: doorsturen vanuit Gmail, of de
// inschrijving op de nieuwsbrief bij Mailchimp. Het adres van de app is geen
// mailbox; zonder doorsturen raakt niemand aan die link.
const BEVESTIGING = /bevestig|confirm|verif/i;
const LINK = /https:\/\/mcusercontent\.com\/[^\s"'<>)]+\/files\/[^\s"'<>)]+\.xlsx/i;
const MAX_BESTAND = 5 * 1024 * 1024;

/** De kolommen die er moeten zijn. De volgorde mag wijzigen, de namen niet. */
const KOLOMMEN = {
  datum: 'datum',
  tijd: 'tijd',
  thuis: 'thuis ploeg',
  uit: 'uit ploeg',
  reeks: 'reeks',
  official1: 'official 1',
  official2: 'official 2',
};

// ---------------------------------------------------------------------------
// Normaliseren — dezelfde vorm voor de lijst en voor de databank.
// ---------------------------------------------------------------------------

/** 'AB  Inbev Leuven Bears G14 B ' en 'AB InBev Leuven Bears G14 B' zijn gelijk. */
export function naamSleutel(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const iso = (j, m, d) => `${j}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** '3/10/2026' (of een Excel-datumgetal) naar '2026-10-03'; null als het niet lukt. */
export function lijstDatum(waarde) {
  const s = String(waarde ?? '').trim();
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const [, d, mnd, j] = m.map(Number);
    if (mnd >= 1 && mnd <= 12 && d >= 1 && d <= 31) return iso(j, mnd, d);
    return null;
  }
  // Een cel met datumopmaak bewaart een getal: dagen sinds 30/12/1899.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

/** '9:00' (of een Excel-tijdsfractie) naar '09:00'; null als het niet lukt. */
export function lijstUur(waarde) {
  const s = String(waarde ?? '').trim();
  // Eerst de fractie: '0.375' zou anders als 0 uur 37 gelezen worden.
  if (/^0?\.\d{3,}$/.test(s)) {
    const minuten = Math.round(Number(s) * 24 * 60);
    return `${String(Math.floor(minuten / 60)).padStart(2, '0')}:${String(minuten % 60).padStart(2, '0')}`;
  }
  const m = s.match(/^(\d{1,2})[:.h](\d{2})(?::\d{2})?$/);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return null;
}

// ---------------------------------------------------------------------------
// De mail en het bestand.
// ---------------------------------------------------------------------------

/**
 * Wat voor mail is dit? 'lijst' (met de link), 'bevestiging',
 * 'andere-nieuwsbrief' of 'onbekend'.
 */
export function herkenMail(mail) {
  const adres = adresUit(mail.van);
  if (adres === GMAIL_BEVESTIGING) return { soort: 'bevestiging' };
  if (!ONDERWERP.test(mail.onderwerp) && BEVESTIGING.test(mail.onderwerp)) return { soort: 'bevestiging' };
  if (adres !== AFZENDER) return { soort: 'onbekend', adres };
  if (!ONDERWERP.test(mail.onderwerp)) return { soort: 'andere-nieuwsbrief' };

  // Eerst de tekstversie: in de HTML maakt Mailchimp er een trackinglink van.
  const delen = [...mail.tekstdelen].sort((a, b) =>
    (a.type === 'text/plain' ? 0 : 1) - (b.type === 'text/plain' ? 0 : 1));
  for (const d of delen) {
    const link = d.tekst.replace(/&amp;/g, '&').match(LINK)?.[0];
    if (link) return { soort: 'lijst', link };
  }
  return { soort: 'lijst', link: null };
}

/**
 * Rijen uit het werkblad naar wedstrijden. Gooit een fout met een leesbare
 * reden als het bestand niet de verwachte vorm heeft.
 *
 * Officials staan er nooit met naam in: een cel die anders gekleurd is dan de
 * rest van de rij, betekent dat daar iemand is aangeduid. Vergelijken met de
 * eigen rij in plaats van één vaste kleur te verwachten: kiest de bond ooit
 * een ander grijs, dan blijft dit werken, en kleurt ze hele rijen in, dan
 * telt dat niet ten onrechte als een official.
 */
export function leesLijst(rijen) {
  const kopRij = rijen.findIndex((r) => r.some((c) => naamSleutel(c?.waarde) === KOLOMMEN.thuis));
  if (kopRij < 0) throw new Error("Geen kolom 'Thuis ploeg' gevonden: het bestand heeft een andere vorm.");

  const kop = rijen[kopRij].map((c) => naamSleutel(c?.waarde));
  const kolom = {};
  for (const [sleutel, naam] of Object.entries(KOLOMMEN)) {
    kolom[sleutel] = kop.indexOf(naam);
  }
  const ontbreekt = Object.entries(kolom).filter(([, i]) => i < 0).map(([s]) => `'${KOLOMMEN[s]}'`);
  if (ontbreekt.length) {
    throw new Error(`Kolom(men) ${ontbreekt.join(', ')} ontbreken: het bestand heeft een andere vorm.`);
  }

  const wedstrijden = [];
  const onleesbaar = [];
  for (const rij of rijen.slice(kopRij + 1)) {
    const cel = (s) => rij[kolom[s]] ?? { waarde: '', kleur: null };
    if (!cel('thuis').waarde && !cel('datum').waarde) continue;   // lege rij

    const datum = lijstDatum(cel('datum').waarde);
    const uur = lijstUur(cel('tijd').waarde);
    if (!datum || !uur || !cel('thuis').waarde) {
      onleesbaar.push(rij.map((c) => c?.waarde ?? '').join(' | '));
      continue;
    }

    const rijKleur = cel('datum').kleur;
    const aangeduid = (c) => Boolean(c.waarde) || (c.kleur !== null && c.kleur !== rijKleur);

    wedstrijden.push({
      datum,
      uur,
      thuis: cel('thuis').waarde,
      uit: cel('uit').waarde,
      reeks: cel('reeks').waarde,
      officials: (aangeduid(cel('official1')) ? 1 : 0) + (aangeduid(cel('official2')) ? 1 : 0),
    });
  }

  if (wedstrijden.length === 0) throw new Error('Het bestand bevat geen enkele leesbare wedstrijd.');
  // Een paar rare rijen kan; als het er veel zijn, is er iets fundamenteel anders.
  if (onleesbaar.length > Math.max(3, wedstrijden.length * 0.1)) {
    throw new Error(`${onleesbaar.length} rijen hebben geen leesbare datum of tijd: het bestand heeft een andere vorm.`);
  }

  return { wedstrijden, onleesbaar };
}

/**
 * De lijst koppelen aan de eigen thuiswedstrijden.
 *
 * 'Eigen' is: de thuisploeg komt voor bij de wedstrijden van de club in de
 * databank. De Excel bevat heel Vlaanderen, ook wedstrijden waar wij uitploeg
 * zijn — daar zorgt de thuisclub voor officials, dus die doen niet mee.
 *
 * @param {object[]} lijst    uit leesLijst
 * @param {object[]} eigen    matches-rijen (guid, datum, uur, thuis_naam, poule_naam)
 */
export function koppel(lijst, eigen) {
  const ploegen = new Set(eigen.map((m) => naamSleutel(m.thuis_naam)));
  const opSleutel = new Map(eigen.map((m) => [`${naamSleutel(m.thuis_naam)}|${m.datum}|${m.uur}`, m]));

  const gekoppeld = [];
  const nietGekoppeld = [];
  const reeksAfwijking = [];

  for (const w of lijst) {
    const ploeg = naamSleutel(w.thuis);
    if (!ploegen.has(ploeg)) continue;

    const m = opSleutel.get(`${ploeg}|${w.datum}|${w.uur}`);
    if (!m) {
      nietGekoppeld.push(w);
      continue;
    }
    gekoppeld.push({ guid: m.guid, officials: w.officials });
    if (w.reeks && m.poule_naam && naamSleutel(w.reeks) !== naamSleutel(m.poule_naam)) {
      reeksAfwijking.push({ datum: w.datum, uur: w.uur, thuis: w.thuis, lijst: w.reeks, app: m.poule_naam });
    }
  }
  return { gekoppeld, nietGekoppeld, reeksAfwijking };
}

// ---------------------------------------------------------------------------
// Tijd: wanneer mag een lijst meteen verwerkt worden?
// ---------------------------------------------------------------------------

function brussel(nu) {
  const d = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(nu).map((p) => [p.type, p.value]));
  return { datum: `${d.year}-${d.month}-${d.day}`, uur: Number(d.hour) % 24 };
}

/** De woensdag vóór een weekend dat op 'van' begint (vr, za of zo). */
export function woensdagVoor(van) {
  const d = new Date(`${van}T00:00:00Z`);
  const terug = (d.getUTCDay() + 4) % 7;
  return new Date(d.getTime() - terug * 86400000).toISOString().slice(0, 10);
}

/** Is het moment van de woensdagregel (woensdag 14 uur, Brussel) al voorbij? */
export function voorbijMoment(van, nu) {
  const woensdag = woensdagVoor(van);
  const b = brussel(nu);
  return b.datum > woensdag || (b.datum === woensdag && b.uur >= 14);
}

// ---------------------------------------------------------------------------
// Ontvangen en verwerken.
// ---------------------------------------------------------------------------

async function beheerders(env) {
  const { results } = await env.DB.prepare('SELECT email FROM users WHERE is_admin = 1 AND actief = 1').all();
  return results.map((r) => r.email);
}

async function meldBeheerders(env, bericht) {
  await verwittigAllen(env, await beheerders(env), bericht).catch(() => {});
}

async function logLijst(env, veld, nieuw) {
  await log(env.DB, { categorie: 'beheer', soort: 'woensdaglijst', wie: 'systeem', veld, nieuw })
    .catch(() => {});
}

/** De eigen thuiswedstrijden van het seizoen: daaruit volgt welke ploegen 'van ons' zijn. */
async function eigenWedstrijden(db) {
  const { results } = await db.prepare(
    `SELECT guid, datum, uur, thuis_naam, poule_naam
       FROM matches WHERE status = 'actief' AND bron = 'vbl'`,
  ).all();
  return results;
}

/**
 * Een binnenkomende mail. Gooit nooit: een geweigerde mail zou terugkaatsen
 * naar de afzender, en dat is de bond of Gmail.
 *
 * @param {object} env
 * @param {string} raw   de volledige mail
 * @param {{naar?: string, nu?: Date}} [opties]
 */
export async function ontvangMail(env, raw, { naar = '', nu = new Date() } = {}) {
  let mail;
  try {
    mail = leesMail(raw);
  } catch (err) {
    await logLijst(env, 'mail genegeerd', `onleesbare mail: ${err.message}`);
    return { soort: 'onleesbaar' };
  }
  const herkend = herkenMail(mail);

  if (herkend.soort === 'bevestiging') {
    // Gmail (doorsturen) of Mailchimp (inschrijving op de nieuwsbrief) vraagt
    // een bevestiging. Het adres is geen mailbox: zonder deze stap raakt
    // niemand aan de link.
    const inhoud = mail.tekstdelen.find((d) => d.type === 'text/plain')?.tekst
      ?? (mail.tekstdelen[0]?.tekst ?? '').replace(/<[^>]+>/g, ' ');
    const adres = naar || 'het adres van de app';
    await meldBeheerders(env, {
      soort: 'bericht',
      onderwerp: `Bevestiging gevraagd voor ${adres}: ${mail.onderwerp}`,
      tekst: `Hallo,\n\n${mail.van} vraagt een bevestiging voor ${adres}. Hieronder de ` +
        `mail zoals ze binnenkwam; klik op de link of vul de code in.\n\n` +
        `${inhoud.replace(/\n{3,}/g, '\n\n').trim()}`,
    });
    await logLijst(env, 'bevestiging doorgestuurd', `${adresUit(mail.van)}: ${mail.onderwerp}`);
    return { soort: herkend.soort };
  }

  if (herkend.soort !== 'lijst') {
    await logLijst(env, 'mail genegeerd', `${herkend.soort === 'onbekend' ? `afzender ${herkend.adres}` : 'andere nieuwsbrief'}: ${mail.onderwerp}`);
    return { soort: herkend.soort };
  }

  const fout = async (reden) => {
    await env.DB.prepare(
      `INSERT INTO vbl_lijsten (onderwerp, bestand, status, fout) VALUES (?, ?, 'fout', ?)`,
    ).bind(mail.onderwerp, herkend.link, reden).run();
    await meldBeheerders(env, templateLijstFout({ reden, onderwerp: mail.onderwerp }));
    await logLijst(env, 'lijst niet verwerkt', reden);
    return { soort: 'fout', reden };
  };

  if (!herkend.link) return fout('Geen link naar een Excel-bestand gevonden in de mail.');

  let lijst;
  try {
    const res = await fetch(herkend.link);
    if (!res.ok) return fout(`Het Excel-bestand kon niet opgehaald worden (HTTP ${res.status}).`);
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_BESTAND) return fout('Het Excel-bestand is onverwacht groot.');
    lijst = leesLijst((await leesXlsx(buffer)).rijen);
  } catch (err) {
    return fout(err.message);
  }

  // Het weekend is altijd minstens zaterdag en zondag, ook als de lijst
  // toevallig maar over één dag gaat: een wedstrijd op de andere dag staat er
  // dan niet in omdat de bond er twee voorziet, niet omdat ze buiten de lijst valt.
  const datums = lijst.wedstrijden.map((w) => w.datum).sort();
  const zaterdag = new Date(`${woensdagVoor(datums[0])}T00:00:00Z`);
  const za = new Date(zaterdag.getTime() + 3 * 86400000).toISOString().slice(0, 10);
  const zo = new Date(zaterdag.getTime() + 4 * 86400000).toISOString().slice(0, 10);
  const van = datums[0] < za ? datums[0] : za;
  const tot = datums[datums.length - 1] > zo ? datums[datums.length - 1] : zo;
  const vandaag = nu.toISOString().slice(0, 10);
  if (tot < vandaag) return fout(`De lijst gaat over ${van} tot ${tot}, en dat is voorbij.`);

  // Rechtstreeks én doorgestuurd kan allebei: wat het eerst binnenkomt, telt.
  const bestaand = await env.DB.prepare(
    `SELECT id FROM vbl_lijsten WHERE weekend_van = ? AND status IN ('ontvangen', 'verwerkt')`,
  ).bind(van).first();
  if (bestaand) {
    await env.DB.prepare(
      `INSERT INTO vbl_lijsten (onderwerp, bestand, weekend_van, weekend_tot, aantal_rijen, status)
       VALUES (?, ?, ?, ?, ?, 'dubbel')`,
    ).bind(mail.onderwerp, herkend.link, van, tot, lijst.wedstrijden.length).run();
    await logLijst(env, 'lijst dubbel ontvangen', `${van} tot ${tot}: genegeerd`);
    return { soort: 'dubbel' };
  }

  const { gekoppeld, nietGekoppeld, reeksAfwijking } = koppel(lijst.wedstrijden, await eigenWedstrijden(env.DB));
  const ingevoegd = await env.DB.prepare(
    `INSERT INTO vbl_lijsten (onderwerp, bestand, weekend_van, weekend_tot, aantal_rijen,
                              eigen, meldingen, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ontvangen') RETURNING id`,
  ).bind(
    mail.onderwerp, herkend.link, van, tot, lijst.wedstrijden.length,
    JSON.stringify(gekoppeld), JSON.stringify({ nietGekoppeld, reeksAfwijking, onleesbaar: lijst.onleesbaar }),
  ).first();

  await logLijst(env, 'lijst ontvangen',
    `${van} tot ${tot}: ${lijst.wedstrijden.length} wedstrijden, ${gekoppeld.length} eigen`);

  if (!voorbijMoment(van, nu)) return { soort: 'ontvangen', id: ingevoegd.id };

  const r = await verwerkLijst(env, ingevoegd.id, nu);
  return { soort: 'verwerkt', id: ingevoegd.id, resultaat: r };
}

/**
 * Een bewaarde lijst toepassen op de aanduidingslijst.
 *
 * - In de lijst: in de aanduidingslijst (tenzij een beheerder ze er bewust
 *   uithaalde), met het aantal officials volgens de bond.
 * - Niet in de lijst: de bond voorziet twee. Stond ze er automatisch in, dan
 *   eruit — behalve als er al iemand van de club op staat: dan laten staan en
 *   melden. Nooit stil iets weghalen waar iemand op staat.
 */
export async function verwerkLijst(env, lijstId, nu = new Date()) {
  const db = env.DB;
  const lijst = await db.prepare('SELECT * FROM vbl_lijsten WHERE id = ?').bind(lijstId).first();
  const bond = new Map(JSON.parse(lijst.eigen ?? '[]').map((g) => [g.guid, g.officials]));
  const meldingen = JSON.parse(lijst.meldingen ?? '{}');

  const { results: kandidaten } = await db.prepare(
    `SELECT m.guid, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.locatie, m.off_aantal,
            m.scope, m.scope_uit, m.scope_reden, m.cat_code, cat.label AS cat_label,
            (SELECT COUNT(*) FROM assignments a
              WHERE a.match_guid = m.guid AND a.status = 'toegewezen') AS bezet
       FROM matches m
       -- Enkel gekende categorieën vanaf U14: U10/U12 duidt de bond nooit aan,
       -- en een onbekende categorie (G08, ROL) ook niet.
       JOIN categorieen cat ON cat.code = m.cat_code
      WHERE m.status = 'actief' AND m.bron = 'vbl'
        AND m.forfait IS NULL
        AND cat.groep != 'U10U12'
        AND m.datum BETWEEN ? AND ?
      ORDER BY m.datum, m.uur, m.thuis_naam COLLATE NOCASE`,
  ).bind(lijst.weekend_van, lijst.weekend_tot).all();

  const r = {
    van: lijst.weekend_van,
    tot: lijst.weekend_tot,
    aantalRijen: lijst.aantal_rijen,
    aantalEigen: bond.size,
    toegevoegd: [],
    uitGehaald: [],
    blijftStaan: [],
    afwijkingA: [],
    afwijkingB: [],
    nietGekoppeld: meldingen.nietGekoppeld ?? [],
    reeksAfwijking: meldingen.reeksAfwijking ?? [],
  };

  const opdrachten = [];
  const nuIso = nu.toISOString();

  for (const m of kandidaten) {
    const w = { guid: m.guid, datum: m.datum, uur: m.uur, thuis: m.thuis_naam, uit: m.uit_naam,
      locatie: m.locatie, catCode: m.cat_code, catLabel: m.cat_label };
    const officialsBond = bond.has(m.guid) ? bond.get(m.guid) : 2;
    opdrachten.push(db.prepare('UPDATE matches SET bond_officials = ? WHERE guid = ?').bind(officialsBond, m.guid));

    if (bond.has(m.guid)) {
      if (m.off_aantal > officialsBond) r.afwijkingB.push({ ...w, api: m.off_aantal, bond: officialsBond });
      if (!m.scope && !m.scope_uit) {
        opdrachten.push(db.prepare(
          // Dezelfde reden als de woensdagregel: inhoudelijk ís dit de
          // woensdagregel, en een nieuwe waarde zou de CHECK op scope_reden
          // wijzigen — dat kan niet met ALTER en zou matches laten droppen.
          `UPDATE matches SET scope = 1, scope_reden = 'woensdag', scope_op = ? WHERE guid = ?`,
        ).bind(nuIso, m.guid));
        r.toegevoegd.push({ ...w, nogNodig: aantalNodig(Math.max(m.off_aantal, officialsBond)) });
      }
      continue;
    }

    if (m.off_aantal < 2) r.afwijkingA.push(w);
    // Enkel wat er automatisch in kwam; wat een beheerder er zelf in zette,
    // blijft zijn beslissing.
    if (m.scope && m.scope_reden === 'woensdag') {
      if (m.bezet > 0) {
        r.blijftStaan.push(w);
      } else {
        opdrachten.push(db.prepare(
          'UPDATE matches SET scope = 0, scope_reden = NULL, scope_op = ? WHERE guid = ?',
        ).bind(nuIso, m.guid));
        r.uitGehaald.push(w);
      }
    }
  }

  opdrachten.push(db.prepare(
    `UPDATE vbl_lijsten SET status = 'verwerkt', verwerkt_op = ? WHERE id = ?`,
  ).bind(nuIso, lijstId));
  await db.batch(opdrachten);

  await logLijst(env, 'lijst verwerkt',
    `${r.van} tot ${r.tot}: ${r.toegevoegd.length} toegevoegd, ${r.uitGehaald.length} eruit, ` +
    `${r.afwijkingA.length + r.afwijkingB.length} afwijking(en)`);

  if (r.toegevoegd.length > 0) {
    const { results: yoPlus } = await db
      .prepare("SELECT email FROM users WHERE profiel = 'YO+' AND actief = 1").all();
    await verwittigAllen(env, yoPlus.map((u) => u.email),
      templateWoensdagregel({ wedstrijden: r.toegevoegd, van: r.van, tot: r.tot })).catch(() => {});
  }
  await meldBeheerders(env, templateWoensdaglijstBeheer(r));

  return r;
}

/** De lijst voor het weekend dat op 'nu' volgt, als die er is. */
async function lijstVoor(db, nu) {
  const [zaterdag, zondag] = komendWeekend(nu);
  return db.prepare(
    `SELECT * FROM vbl_lijsten
      WHERE status IN ('ontvangen', 'verwerkt') AND weekend_van <= ? AND weekend_tot >= ?
      ORDER BY id DESC LIMIT 1`,
  ).bind(zondag, zaterdag).first();
}

/** Woensdag 14 uur: verwerken, of melden dat de lijst er nog niet is. */
export async function woensdagOm14(env, nu) {
  const lijst = await lijstVoor(env.DB, nu);
  if (lijst?.status === 'ontvangen') return { soort: 'verwerkt', resultaat: await verwerkLijst(env, lijst.id, nu) };
  if (lijst?.status === 'verwerkt') return { soort: 'al-verwerkt' };

  const [van, tot] = komendWeekend(nu);
  await meldBeheerders(env, templateLijstNietBinnen({ van, tot }));
  await logLijst(env, 'lijst nog niet binnen', `${van} tot ${tot}, om 14 uur`);
  return { soort: 'niet-binnen' };
}

/** Woensdag 20 uur: nog altijd geen lijst, dan de woensdagregel met de API. */
export async function woensdagTerugval(env, nu) {
  if (await lijstVoor(env.DB, nu)) return { soort: 'niet-nodig' };

  const r = await pasWoensdagregelToe(env.DB, nu);
  if (r.gescoopt > 0) {
    const { results: yoPlus } = await env.DB
      .prepare("SELECT email FROM users WHERE profiel = 'YO+' AND actief = 1").all();
    await verwittigAllen(env, yoPlus.map((u) => u.email), templateWoensdagregel(r)).catch(() => {});
  }
  await meldBeheerders(env, templateTerugval(r));
  await logLijst(env, 'terugval op de API', `${r.van} tot ${r.tot}: ${r.gescoopt} in de lijst gezet`);
  return { soort: 'terugval', resultaat: r };
}
