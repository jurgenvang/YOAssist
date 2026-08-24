/**
 * Automatische toewijzing.
 *
 * Bewust een zuivere functie: geen databank, geen tijd, geen toeval. Dezelfde
 * invoer geeft altijd dezelfde uitvoer. Dat maakt de regels testbaar én maakt
 * de droogloop betrouwbaar — wat het voorbeeld toont, is exact wat er gebeurt
 * als je bevestigt.
 *
 * Wat de automaat optimaliseert: iedereen ongeveer evenveel wedstrijden. Bij
 * gelijke stand wint wie het minst is toegewezen; blijft het gelijk, dan het
 * e-mailadres alfabetisch. Die laatste regel is arbitrair maar noodzakelijk:
 * zonder vaste volgorde zou dezelfde invoer wisselende resultaten geven.
 *
 * Wat ze niet doet: bestaande toewijzingen aanraken. Wat een beheerder heeft
 * gezet, blijft staan.
 */

import { botst } from './aanduiding.js';

/**
 * @param {object[]} wedstrijden  {guid, datum, uur, accGuid, nodig, bezet}
 * @param {Map<string,string[]>} kandidaten  wedstrijd-guid -> e-mailadressen
 * @param {Map<string,number>} telling  e-mail -> aantal toewijzingen dit seizoen
 * @param {Map<string,object[]>} agenda  e-mail -> wedstrijden waaraan al toegewezen
 */
export function plan({ wedstrijden, kandidaten, telling = new Map(), agenda = new Map() }) {
  // Kopieën: de aanroeper mag niet ongemerkt gewijzigd worden.
  const stand = new Map(telling);
  const bezetting = new Map();
  for (const [email, lijst] of agenda) bezetting.set(email, [...lijst]);

  const tekort = wedstrijden
    .map((w) => ({ ...w, open: Math.max(0, (w.nodig ?? 0) - (w.bezet ?? 0)) }))
    .filter((w) => w.open > 0);

  // Schaarste eerst. Een wedstrijd met twee kandidaten moet vóór een wedstrijd
  // met tien aan de beurt komen, anders zijn die twee al weg en blijft ze leeg.
  const volgorde = [...tekort].sort((a, b) => {
    const ka = (kandidaten.get(a.guid) ?? []).length;
    const kb = (kandidaten.get(b.guid) ?? []).length;
    if (ka !== kb) return ka - kb;
    if (a.datum !== b.datum) return a.datum < b.datum ? -1 : 1;
    if (a.uur !== b.uur) return a.uur < b.uur ? -1 : 1;
    return a.guid < b.guid ? -1 : 1;
  });

  const toewijzingen = [];
  const onvolledig = [];

  for (const w of volgorde) {
    const beschikbaar = kandidaten.get(w.guid) ?? [];
    const gekozen = [];
    const geweigerd = new Map(); // email -> reden

    while (gekozen.length < w.open) {
      const bruikbaar = beschikbaar
        .filter((email) => !gekozen.includes(email))
        .filter((email) => {
          const reeds = bezetting.get(email) ?? [];
          if (reeds.some((b) => b.guid === w.guid)) {
            geweigerd.set(email, 'staat er al op');
            return false;
          }
          const botsing = reeds.find((b) => botst(w, b));
          if (botsing) {
            geweigerd.set(email, `botst met ${botsing.datum} ${botsing.uur}`);
            return false;
          }
          return true;
        })
        .sort((a, b) => {
          const va = stand.get(a) ?? 0;
          const vb = stand.get(b) ?? 0;
          if (va !== vb) return va - vb;
          return a < b ? -1 : 1;
        });

      if (bruikbaar.length === 0) break;

      const email = bruikbaar[0];
      gekozen.push(email);
      toewijzingen.push({ guid: w.guid, email });

      stand.set(email, (stand.get(email) ?? 0) + 1);
      bezetting.set(email, [
        ...(bezetting.get(email) ?? []),
        { guid: w.guid, datum: w.datum, uur: w.uur, accGuid: w.accGuid },
      ]);
    }

    if (gekozen.length < w.open) {
      onvolledig.push({
        guid: w.guid,
        datum: w.datum,
        uur: w.uur,
        tekort: w.open - gekozen.length,
        toegewezen: gekozen.length,
        reden:
          beschikbaar.length === 0
            ? 'niemand heeft zich beschikbaar gezet'
            : geweigerd.size > 0
              ? 'alle overige kandidaten botsen met een andere aanduiding'
              : 'te weinig beschikbare officials',
        geweigerd: [...geweigerd.entries()].map(([email, reden]) => ({ email, reden })),
      });
    }
  }

  // Verdeling na afloop, zodat een beheerder ziet of het eerlijk uitkomt.
  const verdeling = [...stand.entries()]
    .map(([email, aantal]) => ({ email, aantal }))
    .sort((a, b) => b.aantal - a.aantal || (a.email < b.email ? -1 : 1));

  return {
    toewijzingen,
    onvolledig,
    verdeling,
    aantalToegewezen: toewijzingen.length,
    aantalOnvolledig: onvolledig.length,
  };
}
