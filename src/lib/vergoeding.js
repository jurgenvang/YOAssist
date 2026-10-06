/**
 * Vergoedingen berekenen.
 *
 * Twee soorten regels komen in een afsluiting terecht:
 *
 *  - werk in de maand zelf: elke aanduiding die op het moment van afsluiten
 *    nog op 'toegewezen' staat, op een gespeelde wedstrijd
 *  - correcties op eerdere maanden: aanduidingen die intussen zijn bijgekomen
 *    of weggevallen nadat die maand al was afgesloten
 *
 * Dat tweede is de reden dat er een tabel `vergoeding_verwerkt` bestaat. Zonder
 * spoor van wat er al is uitbetaald, kan een correctie niet berekend worden —
 * je weet dan niet of een ontbrekende aanduiding nooit is meegeteld of net wel.
 *
 * Alles hier is zuiver rekenwerk op gegevens die de aanroeper aanlevert. Dat
 * maakt elke regel testbaar zonder databank en zonder klok.
 */

/** Eerste en laatste dag van een maand 'JJJJ-MM'. */
export function maandBereik(maand) {
  const [jaar, mnd] = String(maand).split('-').map(Number);
  if (!jaar || !mnd || mnd < 1 || mnd > 12) return null;
  const laatste = new Date(Date.UTC(jaar, mnd, 0)).toISOString().slice(0, 10);
  return { van: `${maand}-01`, tot: laatste };
}

/** De maand waarin een datum valt. */
export function maandVan(datum) {
  return String(datum).slice(0, 7);
}

/**
 * Mag deze maand afgesloten worden?
 *
 * Ten vroegste op de eerste dag van de volgende maand: zolang de maand loopt,
 * kan er nog gefloten worden.
 */
export function magAfsluiten(maand, vandaag) {
  const bereik = maandBereik(maand);
  if (!bereik) return { mag: false, reden: 'ongeldige maand' };
  if (vandaag <= bereik.tot) {
    return { mag: false, reden: 'de maand is nog niet voorbij' };
  }
  return { mag: true };
}

/**
 * Bouwt de regels voor één afsluiting.
 *
 * @param {object[]} teVergoeden  aanduidingen in de af te sluiten maand:
 *   {matchGuid, email, naam, catCode, catLabel, tariefCent}
 * @param {object[]} correcties   verschillen op eerdere maanden:
 *   {email, naam, betreftMaand, catCode, catLabel, tariefCent, aantal}
 */
export function bouwRegels(teVergoeden, correcties = []) {
  const regels = new Map();

  const sleutel = (email, soort, betreft, cat) =>
    `${email}|${soort}|${betreft ?? ''}|${cat}`;

  for (const w of teVergoeden) {
    const s = sleutel(w.email, 'wedstrijd', null, w.catCode);
    const bestaand = regels.get(s);
    if (bestaand) {
      bestaand.aantal += 1;
      bestaand.bedragCent += w.tariefCent;
    } else {
      regels.set(s, {
        email: w.email,
        naam: w.naam,
        soort: 'wedstrijd',
        betreftMaand: null,
        catCode: w.catCode,
        catLabel: w.catLabel,
        aantal: 1,
        tariefCent: w.tariefCent,
        bedragCent: w.tariefCent,
      });
    }
  }

  for (const c of correcties) {
    if (c.aantal === 0) continue;
    const s = sleutel(c.email, 'correctie', c.betreftMaand, c.catCode);
    const bestaand = regels.get(s);
    if (bestaand) {
      bestaand.aantal += c.aantal;
      bestaand.bedragCent += c.aantal * c.tariefCent;
    } else {
      regels.set(s, {
        email: c.email,
        naam: c.naam,
        soort: 'correctie',
        betreftMaand: c.betreftMaand,
        catCode: c.catCode,
        catLabel: c.catLabel,
        aantal: c.aantal,
        tariefCent: c.tariefCent,
        bedragCent: c.aantal * c.tariefCent,
      });
    }
  }

  // Regels die op nul uitkomen weglaten: een correctie van +1 en −1 in dezelfde
  // maand is geen informatie, alleen ruis op het overzicht.
  return [...regels.values()]
    .filter((r) => r.aantal !== 0)
    .sort((a, b) => {
      if (a.naam !== b.naam) return a.naam.localeCompare(b.naam, 'nl');
      if (a.soort !== b.soort) return a.soort === 'wedstrijd' ? -1 : 1;
      if (a.betreftMaand !== b.betreftMaand) {
        return (a.betreftMaand ?? '').localeCompare(b.betreftMaand ?? '');
      }
      return a.catCode.localeCompare(b.catCode);
    });
}

/** Groepeert regels per official, met een totaal. */
export function perOfficial(regels) {
  const officials = new Map();

  for (const r of regels) {
    const bestaand = officials.get(r.email) ?? {
      email: r.email,
      naam: r.naam,
      regels: [],
      totaalCent: 0,
      aantalWedstrijden: 0,
    };
    bestaand.regels.push(r);
    bestaand.totaalCent += r.bedragCent;
    bestaand.aantalWedstrijden += r.aantal;
    officials.set(r.email, bestaand);
  }

  return [...officials.values()].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

/**
 * De wedstrijden achter de regels, per official.
 *
 * Een regel '3 × U12' zegt hoeveel, niet welke. Wie een fout in het bedrag
 * zoekt, moet de wedstrijden zelf zien — anders begint het zoeken in het
 * cluboverzicht en het logboek.
 *
 * @param {object[]} items  {email, matchGuid, datum, thuisNaam, uitNaam,
 *   catCode, catLabel, soort, betreftMaand, aantal}
 * @returns {Map<string, object[]>} per e-mailadres, chronologisch
 */
export function wedstrijdenPerOfficial(items) {
  const per = new Map();

  for (const w of items) {
    // Zelfde reden als in bouwRegels: een saldo van nul is geen informatie.
    if (w.aantal === 0) continue;
    per.set(w.email, [
      ...(per.get(w.email) ?? []),
      {
        matchGuid: w.matchGuid,
        datum: w.datum ?? null,
        // Een wedstrijd die intussen uit de databank verdween, heeft geen
        // namen meer; de GUID is dan het enige houvast.
        wedstrijd: w.thuisNaam ? `${w.thuisNaam} - ${w.uitNaam ?? ''}`.trim() : w.matchGuid,
        catCode: w.catCode,
        catLabel: w.catLabel ?? null,
        soort: w.soort,
        betreftMaand: w.betreftMaand ?? null,
        aantal: w.aantal,
      },
    ]);
  }

  for (const lijst of per.values()) {
    lijst.sort((a, b) => (a.datum ?? '').localeCompare(b.datum ?? '')
      || a.wedstrijd.localeCompare(b.wedstrijd, 'nl'));
  }

  return per;
}

/** '€ 65,00' uit 6500. */
export function alsBedrag(cent) {
  const negatief = cent < 0;
  const absoluut = Math.abs(cent);
  const tekst = `€ ${Math.floor(absoluut / 100)},${String(absoluut % 100).padStart(2, '0')}`;
  return negatief ? `− ${tekst}` : tekst;
}
