/**
 * Mail versturen.
 *
 * Eén functie (`verstuur`) die alle andere mailcode gebruikt. Templates zijn
 * platte tekst met een dun laagje HTML — geen React Email, geen build stap,
 * dit hoeft niet mooier te zijn dan een duidelijke mededeling.
 *
 * De zandbakgrens wordt hier afgedwongen, niet bij de aanroeper: elke plek die
 * ooit mail verstuurt gaat door deze functie, dus één controle hier dekt alles
 * voor altijd. Vergeet een toekomstige aanroeper de grens te checken, dan
 * beschermt dit bestand hem alsnog.
 */

import { instelling } from './http.js';

/**
 * Het zandbakadres van Resend. Werkt zonder enig domein, maar levert alleen af
 * bij het adres waarmee het Resend-account is aangemaakt.
 */
export const ZANDBAK_AFZENDER = 'onboarding@resend.dev';

export function isZandbak(afzender) {
  return typeof afzender === 'string' && afzender.trim().toLowerCase().endsWith('@resend.dev');
}

/**
 * @returns {Promise<{verstuurd: boolean, reden?: string}>}
 */
export async function verstuur(env, { naar, onderwerp, tekst, html }) {
  const afzender = await instelling(env.DB, 'mail_afzender', '');
  const afzenderNaam = await instelling(env.DB, 'mail_afzender_naam', 'YOAssist');

  if (!afzender) return { verstuurd: false, reden: 'geen-afzender' };
  if (!env.RESEND_API_KEY) return { verstuurd: false, reden: 'geen-sleutel' };

  // In de zandbak levert Resend toch alleen af bij het geregistreerde adres.
  // Dat afdwingen vóór de aanroep bespaart een mislukte poging en een
  // verwarrende foutmelding in de logs.
  if (isZandbak(afzender) && naar.toLowerCase() !== afzender.toLowerCase()) {
    return { verstuurd: false, reden: 'zandbak-andere-ontvanger' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${afzenderNaam} <${afzender}>`,
        to: naar,
        subject: onderwerp,
        text: tekst,
        html: html ?? `<p>${escapeHtml(tekst).replace(/\n/g, '<br>')}</p>`,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { verstuurd: false, reden: body?.message || `status ${res.status}` };
    }

    return { verstuurd: true };
  } catch (err) {
    return { verstuurd: false, reden: err.message };
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// Templates. Elke functie geeft {onderwerp, tekst} terug — geen bijwerkingen,
// geen databanktoegang, dus makkelijk te testen los van het versturen zelf.
// ---------------------------------------------------------------------------

export function templateAanduiding({ naam, wedstrijd, datum, uur, locatie, opkomst, matchGuid }) {
  return {
    soort: 'aanduiding',
    matchGuid,
    kort: `${datum} om ${uur}${locatie ? ` — ${locatie}` : ''}`,
    onderwerp: `Aangeduid: ${wedstrijd}`,
    tekst:
      `Hallo ${naam},\n\n` +
      `Je bent aangeduid voor:\n\n` +
      `${wedstrijd}\n${datum} om ${uur}\n${locatie || 'locatie volgt nog'}\n\n` +
      `Aanwezig op het terrein om ${opkomst}.\n\n` +
      `Kan je niet, meld dat dan in YOAssist bij deze wedstrijd — niet door gewoon niet te komen opdagen.`,
  };
}

export function templateVrijgegeven({ naam, wedstrijd, datum, uur, matchGuid }) {
  return {
    soort: 'vrijgave',
    matchGuid,
    kort: `${datum} om ${uur} — je staat weer als beschikbaar`,
    onderwerp: `Aanduiding vervallen: ${wedstrijd}`,
    tekst:
      `Hallo ${naam},\n\n` +
      `Je aanduiding voor ${wedstrijd} (${datum} om ${uur}) is ingetrokken.\n\n` +
      `Je staat weer als beschikbaar in YOAssist voor deze wedstrijd.`,
  };
}

export function templateHerinnering({ naam, wedstrijden, wanneer }) {
  const kort = wedstrijden.map((w) => `${w.uur} ${w.wedstrijd}`).join(', ');
  const lijst = wedstrijden
    .map((w) => `- ${w.uur} ${w.wedstrijd} (${w.locatie || 'locatie volgt'}) — op het terrein om ${w.opkomst}`)
    .join('\n');

  return {
    soort: 'herinnering',
    kort,
    onderwerp:
      wedstrijden.length === 1
        ? `Herinnering: ${wedstrijden[0].wedstrijd}`
        : `Herinnering: ${wedstrijden.length} wedstrijden`,
    tekst: `Hallo ${naam},\n\n${wanneer} moet je fluiten:\n\n${lijst}\n\nTot dan.`,
  };
}

/**
 * Herinnering voor wie nog geen beschikbaarheid opgaf voor een specifiek
 * weekend. Anders dan templateHerinnering hierboven: die gaat over wie al
 * aangeduid is en morgen fluit, dit gaat over wie nog helemaal niets heeft
 * ingevuld. Twee losse dingen die op elkaar lijken maar een andere doelgroep
 * raken.
 */
export function templateVulNogIn({ naam, wedstrijden, van, tot }) {
  const kort = `${wedstrijden.length} wedstrijden nog te beantwoorden`;
  const lijst = wedstrijden
    .map((w) => `- ${w.datum} ${w.uur} ${w.thuis} - ${w.uit}`)
    .join('\n');

  return {
    soort: 'nog-in-te-vullen',
    kort,
    onderwerp: `Nog te beantwoorden: weekend van ${van}`,
    tekst:
      `Hallo ${naam},\n\n` +
      `Voor het weekend van ${van} tot ${tot} heb je nog niet aangegeven of je ` +
      `kan fluiten bij:\n\n${lijst}\n\n` +
      `Zet je beschikbaarheid in YOAssist, ook als het nee is — dan weet de ` +
      `beheerder waar hij aan toe is.`,
  };
}

export function templateProbleem({ naam, wedstrijd, bericht, official }) {
  return {
    onderwerp: `Probleem gemeld: ${wedstrijd}`,
    tekst:
      `${official} heeft een probleem gemeld bij ${wedstrijd}:\n\n"${bericht}"\n\n` +
      `Bekijk het in het beheerscherm bij Problemen.`,
  };
}

export function templateWoensdagregel({ wedstrijden, van, tot }) {
  // eslint-disable-next-line no-unused-vars
  const lijst = wedstrijden
    .map((w) => `- ${w.datum} ${w.uur} ${w.thuis} - ${w.uit} (nog ${w.nogNodig} nodig)`)
    .join('\n');

  return {
    onderwerp: `${wedstrijden.length} wedstrijden zonder scheidsrechter dit weekend`,
    tekst:
      `Voor het weekend van ${van} tot ${tot} heeft Basketbal Vlaanderen nog geen ` +
      `twee scheidsrechters aangeduid bij:\n\n${lijst}\n\nZet je beschikbaar in YOAssist als je kan.`,
  };
}

export function templateAvondcontrole({ wedstrijden }) {
  const lijst = wedstrijden.map((w) => `- ${w.omschrijving}`).join('\n');

  return {
    onderwerp: `${wedstrijden.length} wedstrijd(en) hebben nu een VBL-scheidsrechter`,
    tekst:
      `Basketbal Vlaanderen heeft intussen twee scheidsrechters aangeduid bij:\n\n${lijst}\n\n` +
      `Ze staan nog in de aanduidingslijst. Bekijk of ze eruit moeten in het cluboverzicht.`,
  };
}

export function templateWeekoverzicht({ u10u12, overig, van, tot }) {
  const regel = (w) => `- ${w.datum} ${w.uur} ${w.thuis} - ${w.uit} (nog ${w.nogNodig} nodig)`;
  const secties = [];

  if (u10u12.length) secties.push(`U10/U12 (${u10u12.length}):\n${u10u12.map(regel).join('\n')}`);
  if (overig.length) secties.push(`Overige (${overig.length}):\n${overig.map(regel).join('\n')}`);

  return {
    onderwerp: `Weekoverzicht ${van} tot ${tot}: ${u10u12.length + overig.length} nog aan te vullen`,
    tekst:
      secties.length > 0
        ? `Wedstrijden van ${van} tot ${tot} die nog niet volledig zijn aangeduid:\n\n${secties.join('\n\n')}`
        : `Alle wedstrijden van ${van} tot ${tot} zijn volledig aangeduid.`,
  };
}


/**
 * Welkomstbericht voor een nieuwe official.
 *
 * Legt uit waarvoor de app dient en hoe je ze op je telefoon zet. Dat laatste
 * staat er uitgeschreven per besturingssysteem: "voeg toe aan je beginscherm"
 * is voor wie het nooit gedaan heeft geen instructie maar een raadsel, en op
 * iOS is het bovendien de enige manier om meldingen te kunnen krijgen.
 */
const AANMELD_UITLEG = {
  pin: 'Vul je e-mailadres in. Je krijgt een code toegestuurd; die vul je in en ' +
       'je bent binnen. Geen wachtwoord om te onthouden.',
  google: 'Klik eerst op "Sign in with Cloudflare", kies dan "Google" en meld je ' +
          'aan met je Google-account. Dat moet wel het adres zijn waarop je deze ' +
          'mail kreeg.',
  apple: 'Klik eerst op "Sign in with Cloudflare", kies dan "Apple" en meld je aan ' +
         'met je Apple ID. Dat moet wel het adres zijn waarop je deze mail kreeg.',
  microsoft: 'Kies "Microsoft" en meld je aan met je Microsoft-account. Dat moet ' +
             'wel het adres zijn waarop je deze mail kreeg.',
  github: 'Kies "GitHub" en meld je aan met je GitHub-account. Dat moet wel het ' +
          'adres zijn waarop je deze mail kreeg.',
};

export function templateWelkom({ naam, clubNaam, adres, isAdmin, methodes }) {
  const voornaam = String(naam ?? '').split(' ')[0] || 'daar';

  // Alleen de methodes noemen die effectief aanstaan. Verwijzen naar een knop
  // die er niet is, kost meer uitleg dan ze bespaart.
  const gekozen = (Array.isArray(methodes) ? methodes : ['pin'])
    .filter((m) => AANMELD_UITLEG[m]);
  if (gekozen.length === 0) gekozen.push('pin');

  const rol = isAdmin
    ? 'Je bent beheerder: je duidt de officials aan en beheert de club.'
    : 'Je geeft er op wanneer je kunt fluiten. Een beheerder duidt daarna aan wie ' +
      'welke wedstrijd doet.';

  return {
    onderwerp: `Welkom bij YOAssist${clubNaam ? ` — ${clubNaam}` : ''}`,
    tekst:
      `Hallo ${voornaam},\n\n` +
      `Je bent toegevoegd aan YOAssist, de app waarmee ${clubNaam || 'de club'} de ` +
      `scheidsrechters voor de thuiswedstrijden regelt.\n\n` +
      `${rol}\n\n` +
      `Het gaat om wedstrijden U10 en U12 — daar duidt de bond nooit zelf ` +
      `scheidsrechters aan — en om wedstrijden vanaf U14 waarop Basketbal ` +
      `Vlaanderen zelf geen scheidsrechters aanduidde.\n\n` +

      `AANMELDEN\n` +
      `Ga naar ${adres}. ` +
      (gekozen.length > 1
        ? `Je krijgt een keuzescherm met ${gekozen.length} manieren om aan te melden:\n\n` +
          gekozen.map((m) => `- ${AANMELD_UITLEG[m]}`).join('\n') + '\n\n' +
          'Welke je kiest maakt niet uit, zolang het bij dit e-mailadres hoort.\n\n'
        : `${AANMELD_UITLEG[gekozen[0]]}\n\n`) +

      `ZET DE APP OP JE TELEFOON\n` +
      `Zo staat ze tussen je andere apps en hoef je het adres niet te onthouden.\n\n` +

      `Op een iPhone of iPad:\n` +
      `1. Open ${adres} in Safari (niet in Chrome — dit werkt alleen in Safari)\n` +
      `2. Tik onderaan op het deelicoon: het vierkantje met de pijl omhoog\n` +
      `3. Scrol naar beneden en kies "Zet op beginscherm"\n` +
      `4. Tik op "Voeg toe"\n` +
      `Open de app daarna via dat icoon. Alleen dan kun je meldingen aanzetten; ` +
      `dat is een regel van Apple.\n\n` +

      `Op Android:\n` +
      `1. Open ${adres} in Chrome\n` +
      `2. Tik rechtsboven op de drie puntjes\n` +
      `3. Kies "App installeren" of "Toevoegen aan startscherm"\n\n` +

      `WAT JE MOET DOEN\n` +
      `Zeg bij elke wedstrijd of je kunt — ook als het nee is. Dan weet de ` +
      `beheerder waar hij aan toe is. Ja zeggen betekent dat je zou kunnen, niet ` +
      `dat je moet komen: de beheerder kiest daarna wie er effectief fluit, en ` +
      `daar krijg je bericht van.\n\n` +
      `Ben je aangeduid en lukt het toch niet, meld dat dan in de app bij die ` +
      `wedstrijd. Niet met een berichtje aan je trainer — dan komt het niet bij ` +
      `de juiste persoon terecht.\n\n` +

      `Bij je naam rechtsboven vind je je voorkeuren, een rondleiding door de app ` +
      `en de handleiding.\n\n` +
      `Tot op het veld.`,
  };
}
