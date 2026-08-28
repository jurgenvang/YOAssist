import { clubWedstrijden, normaliseerWedstrijd, VblError } from './vbl.js';

/**
 * Synchronisatie voor de aandachtspagina (V31): wedstrijden van clubs die een
 * beheerder volgt zonder er zelf officials voor te leveren.
 *
 * Bewust een aparte, kleinere cyclus, los van `synchroniseer()` in sync.js:
 * - Enkel VBL-scheidsrechters tellen, nooit eigen aanduidingen — er zijn hier
 *   ook geen eigen aanduidingen om te tellen.
 * - Geen scope, geen assignments, geen wijzigingslogboek: dit is een simpele
 *   momentopname, geen module om iets te beheren.
 * - Faalt één club, dan gaan de andere gewoon door; net als bij de hoofdsync
 *   mag één trage of foutieve club de rest niet blokkeren.
 */
export async function synchroniseerVolgClubs(db) {
  const { results: clubs } = await db.prepare('SELECT guid, naam FROM volg_clubs').all();

  if (clubs.length === 0) {
    return { clubs: 0, gevonden: 0, fouten: [] };
  }

  const vandaag = new Date().toISOString().slice(0, 10);
  const fouten = [];
  let totaalGevonden = 0;

  for (const club of clubs) {
    let rauweLijst;
    try {
      rauweLijst = await clubWedstrijden(club.guid);
    } catch (err) {
      const boodschap = err instanceof VblError ? err.message : 'onbekende fout';
      fouten.push(`${club.naam || club.guid}: ${boodschap}`);
      continue;
    }

    const opdrachten = [];

    for (const rauw of rauweLijst) {
      const w = normaliseerWedstrijd(rauw);
      if (!w) continue;
      if (w.datum < vandaag) continue;   // enkel wat nog moet gebeuren is relevant

      opdrachten.push(
        db
          .prepare(
            `INSERT INTO volg_wedstrijden
               (guid, club_guid, club_naam, thuis_naam, uit_naam, datum, uur,
                cat_code, vbl_aantal, laatst_gezien)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT (guid) DO UPDATE SET
               club_naam = excluded.club_naam, thuis_naam = excluded.thuis_naam,
               uit_naam = excluded.uit_naam, datum = excluded.datum, uur = excluded.uur,
               cat_code = excluded.cat_code, vbl_aantal = excluded.vbl_aantal,
               laatst_gezien = datetime('now')`,
          )
          .bind(
            w.guid, club.guid, club.naam, w.thuisNaam, w.uitNaam, w.datum, w.uur,
            null, w.offAantal,
          ),
      );
    }

    if (opdrachten.length > 0) await db.batch(opdrachten);
    totaalGevonden += opdrachten.length;
  }

  // Wedstrijden die niet langer bij een gevolgde club horen (club losgekoppeld,
  // of de wedstrijd zelf verdwenen bij de bond) opruimen. Simpeler dan de
  // hoofdsync: geen historiek om te bewaren, dus gewoon weg.
  const clubGuids = clubs.map((c) => c.guid);
  if (clubGuids.length > 0) {
    await db
      .prepare(
        `DELETE FROM volg_wedstrijden
          WHERE datum < ? OR club_guid NOT IN (${clubGuids.map(() => '?').join(',')})`,
      )
      .bind(vandaag, ...clubGuids)
      .run();
  } else {
    await db.prepare('DELETE FROM volg_wedstrijden').run();
  }

  return { clubs: clubs.length, gevonden: totaalGevonden, fouten };
}
