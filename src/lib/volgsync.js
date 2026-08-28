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
// Categorieën die YOAssist bewust buiten deze pagina houdt: U10 en U12 worden
// altijd automatisch aangeduid, dus staan zelden of nooit krap. Enkel vanaf
// U14 heeft het zin om hier op te letten.
const ZONDER_U10U12 = new Set(['G10', 'G12', 'M12']);

/**
 * Haalt de driecijferige categoriecode uit een team-GUID.
 *
 * Vorm: club-GUID, drieletterige categoriecode, twee spaties, volgnummer —
 * bijvoorbeeld 'BVBL1053J16  1'. Voor de eigen club leunt de app op een
 * teams-tabel die dit al eens heeft opgezocht; voor extern gevolgde clubs is
 * die tabel er niet, dus wordt de code hier rechtstreeks uit de GUID gehaald.
 */
function categorieUitGuid(teamGuid, clubGuid) {
  if (!teamGuid || !clubGuid || !teamGuid.startsWith(clubGuid)) return null;
  return teamGuid.slice(clubGuid.length, clubGuid.length + 3).trim().toUpperCase() || null;
}

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

    // Een vaste, in JavaScript bepaalde tijdstempel voor deze club — bewust
    // niet SQL's datetime('now'), dat bij elke rij een net iets ander moment
    // zou geven. Met exact dezelfde waarde op elke geldige rij kan de
    // opruiming straks simpelweg vragen 'welke rijen kregen deze stempel
    // niet', in plaats van een lijst van honderden GUID's te moeten meegeven.
    // D1 staat maximaal honderd gebonden parameters per query toe; filteren
    // op een lijst sleutels loopt daar bij een club met veel wedstrijden
    // tegenaan — dezelfde les die al eerder bij de hoofdsynchronisatie is
    // geleerd.
    const stempel = new Date().toISOString();
    const opdrachten = [];

    for (const rauw of rauweLijst) {
      const w = normaliseerWedstrijd(rauw);
      if (!w) continue;
      // Enkel thuiswedstrijden: alleen daar zijn scheidsrechters van deze club
      // nodig. Dit voorkomt ook een stille fout verderop — bij een
      // uitwedstrijd hoort thuisGuid bij de tegenstander, en dan levert
      // categorieUitGuid() null op in plaats van de juiste categorie, wat
      // U10/U12-wedstrijden van de tegenpartij ongefilterd zou doorlaten.
      if (!w.thuisGuid.startsWith(club.guid)) continue;
      if (w.datum < vandaag) continue;   // enkel wat nog moet gebeuren is relevant
      // Middernacht is bij Basketbal Vlaanderen meestal een teken dat het uur
      // niet correct is doorgekomen, niet een echte wedstrijd om 00:00.
      if (w.uur === '00:00') continue;

      const catCode = categorieUitGuid(w.thuisGuid, club.guid);
      if (catCode && ZONDER_U10U12.has(catCode)) continue;

      // Enkel bij precies één scheidsrechter is een naam bruikbare info: dan
      // weet een beheerder wie hij kan aanspreken om aan te vullen. Bij nul
      // is er niemand om te noemen; bij twee of meer verschijnt de wedstrijd
      // toch al niet op deze pagina.
      const naam = w.offAantal === 1 ? w.offNamen[0] : null;

      opdrachten.push(
        db
          .prepare(
            `INSERT INTO volg_wedstrijden
               (guid, club_guid, club_naam, thuis_naam, uit_naam, datum, uur,
                cat_code, vbl_aantal, vbl_naam, laatst_gezien)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (guid) DO UPDATE SET
               club_naam = excluded.club_naam, thuis_naam = excluded.thuis_naam,
               uit_naam = excluded.uit_naam, datum = excluded.datum, uur = excluded.uur,
               cat_code = excluded.cat_code, vbl_aantal = excluded.vbl_aantal,
               vbl_naam = excluded.vbl_naam, laatst_gezien = excluded.laatst_gezien`,
          )
          .bind(
            w.guid, club.guid, club.naam, w.thuisNaam, w.uitNaam, w.datum, w.uur,
            catCode, w.offAantal, naam, stempel,
          ),
      );
    }

    if (opdrachten.length > 0) await db.batch(opdrachten);
    totaalGevonden += opdrachten.length;

    // Opruimen voor déze club: alles wat niet exact deze stempel kreeg, hoorde
    // er deze ronde niet meer bij (verdwenen bij de bond, een uitwedstrijd
    // geworden, U10/U12, het weekend voorbij, ...). Twee gebonden parameters,
    // ongeacht hoeveel wedstrijden de club heeft — geen limiet om tegenaan te
    // lopen. Werkt ook wanneer er deze ronde nul geldige wedstrijden waren:
    // dan verschilt élke bestaande rij van de stempel en wordt alles geveegd.
    await db
      .prepare('DELETE FROM volg_wedstrijden WHERE club_guid = ? AND laatst_gezien != ?')
      .bind(club.guid, stempel)
      .run();
  }

  // Clubs die intussen losgekoppeld zijn, horen nergens meer bij. Een
  // subquery in plaats van een lijst GUID's: blijft altijd binnen de
  // parametergrens, ongeacht hoeveel clubs er gevolgd worden.
  await db
    .prepare('DELETE FROM volg_wedstrijden WHERE club_guid NOT IN (SELECT guid FROM volg_clubs)')
    .run();

  return { clubs: clubs.length, gevonden: totaalGevonden, fouten };
}
