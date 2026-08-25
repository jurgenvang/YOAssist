/**
 * Het venster van het cluboverzicht.
 *
 * Basketbal draait op weekends. Een venster van "veertien dagen" knipt
 * afhankelijk van de dag van de week een zaterdag af van haar zondag, en dan
 * mist een beheerder de helft van een speeldag zonder dat hij het merkt.
 * Daarom rekenen we in volledige weekends, niet in dagen.
 *
 * Het venster loopt van vandaag tot en met de tweede eerstvolgende zondag.
 * Valt vandaag in een weekend, dan telt dat weekend mee als het eerste — de
 * resterende dag is nog steeds relevant.
 */

const DAG_MS = 86400000;

function iso(d) {
  return d.toISOString().slice(0, 10);
}

/** De eerstvolgende zondag vanaf een dag; vandaag telt mee als het zondag is. */
function volgendeZondag(vanaf) {
  const naar = (7 - vanaf.getUTCDay()) % 7;
  return new Date(vanaf.getTime() + naar * DAG_MS);
}

/**
 * @param {Date} nu
 * @param {number} aantalWeekends
 * @returns {{van: string, tot: string, weekends: {zaterdag: string, zondag: string}[]}}
 */
export function weekendVenster(nu = new Date(), aantalWeekends = 2) {
  const vandaag = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth(), nu.getUTCDate()));

  const weekends = [];
  let zondag = volgendeZondag(vandaag);

  for (let i = 0; i < aantalWeekends; i++) {
    const zaterdag = new Date(zondag.getTime() - DAG_MS);
    weekends.push({ zaterdag: iso(zaterdag), zondag: iso(zondag) });
    zondag = new Date(zondag.getTime() + 7 * DAG_MS);
  }

  return {
    van: iso(vandaag),
    tot: weekends[weekends.length - 1].zondag,
    weekends,
  };
}

/** Leesbare omschrijving voor in de interface, bijvoorbeeld "12–13 en 19–20 sep". */
export function vensterLabel(venster) {
  const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const dag = (d) => Number(d.slice(8, 10));
  const maand = (d) => MAANDEN[Number(d.slice(5, 7)) - 1];

  return venster.weekends
    .map((w, i) => {
      const zelfdeMaand = w.zaterdag.slice(5, 7) === w.zondag.slice(5, 7);
      const laatste = i === venster.weekends.length - 1;
      // Alleen bij het laatste weekend de maand tonen, tenzij het weekend
      // over een maandgrens loopt.
      if (zelfdeMaand && !laatste) return `${dag(w.zaterdag)}–${dag(w.zondag)}`;
      if (zelfdeMaand) return `${dag(w.zaterdag)}–${dag(w.zondag)} ${maand(w.zondag)}`;
      return `${dag(w.zaterdag)} ${maand(w.zaterdag)}–${dag(w.zondag)} ${maand(w.zondag)}`;
    })
    .join(' en ');
}
