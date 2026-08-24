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

export function templateAanduiding({ naam, wedstrijd, datum, uur, locatie, opkomst }) {
  return {
    onderwerp: `Aangeduid: ${wedstrijd}`,
    tekst:
      `Hallo ${naam},\n\n` +
      `Je bent aangeduid voor:\n\n` +
      `${wedstrijd}\n${datum} om ${uur}\n${locatie || 'locatie volgt nog'}\n\n` +
      `Wees om ${opkomst} ter plaatse.\n\n` +
      `Kan je niet, meld dat dan in YOAssist bij deze wedstrijd — niet door gewoon niet te komen opdagen.`,
  };
}

export function templateVrijgegeven({ naam, wedstrijd, datum, uur }) {
  return {
    onderwerp: `Aanduiding vervallen: ${wedstrijd}`,
    tekst:
      `Hallo ${naam},\n\n` +
      `Je aanduiding voor ${wedstrijd} (${datum} om ${uur}) is ingetrokken.\n\n` +
      `Je staat weer als beschikbaar in YOAssist voor deze wedstrijd.`,
  };
}

export function templateHerinnering({ naam, wedstrijden, wanneer }) {
  const lijst = wedstrijden
    .map((w) => `- ${w.uur} ${w.wedstrijd} (${w.locatie || 'locatie volgt'}) — aanwezig om ${w.opkomst}`)
    .join('\n');

  return {
    onderwerp:
      wedstrijden.length === 1
        ? `Herinnering: ${wedstrijden[0].wedstrijd}`
        : `Herinnering: ${wedstrijden.length} wedstrijden`,
    tekst: `Hallo ${naam},\n\n${wanneer} moet je fluiten:\n\n${lijst}\n\nTot dan.`,
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
