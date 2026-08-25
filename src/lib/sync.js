/**
 * Synchronisatie van wedstrijden vanuit Basketbal Vlaanderen.
 *
 * Wordt door twee kanten aangeroepen: het beheerscherm (handmatig) en de
 * cron-Worker (automatisch). Daarom staat de logica hier en niet in een route.
 *
 * Veiligheden die erin zitten, in volgorde van belangrijkheid:
 *  1. Faalt een club-oproep, dan wordt er voor die club niets gewijzigd.
 *  2. Levert een sync nul wedstrijden op terwijl er er in de databank wel zijn,
 *     dan wordt de sync als mislukt beschouwd en gebeurt er niets.
 *  3. Verdwijnen er meer dan DREMPEL_VERDWENEN wedstrijden, dan worden ze niet
 *     als verdwenen gemarkeerd. Nieuwe en gewijzigde wedstrijden worden wel
 *     verwerkt; de run krijgt status 'deels' zodat het opvalt.
 */

import {
  clubWedstrijden,
  normaliseerWedstrijd,
  wedstrijdHash,
  seizoenscode,
  GEVOLGDE_VELDEN,
  VblError,
} from './vbl.js';

export const DREMPEL_VERDWENEN = 3;

async function instelling(db, sleutel, standaard = null) {
  const rij = await db.prepare('SELECT waarde FROM settings WHERE sleutel = ?').bind(sleutel).first();
  return rij ? rij.waarde : standaard;
}

export async function zetInstelling(db, sleutel, waarde) {
  await db
    .prepare(
      `INSERT INTO settings (sleutel, waarde, gewijzigd) VALUES (?, ?, datetime('now'))
       ON CONFLICT (sleutel) DO UPDATE SET waarde = excluded.waarde, gewijzigd = datetime('now')`,
    )
    .bind(sleutel, String(waarde))
    .run();
}

/**
 * @param {D1Database} db
 * @param {'cron'|'handmatig'} bron
 */
export async function synchroniseer(db, bron) {
  const startJaar = Number(await instelling(db, 'seizoen_start_jaar', '2026'));
  const seizoen = seizoenscode(startJaar);

  const runResultaat = await db
    .prepare(`INSERT INTO sync_runs (bron, status) VALUES (?, 'bezig') RETURNING id`)
    .bind(bron)
    .first();
  const runId = runResultaat.id;

  const rapport = {
    runId,
    seizoen,
    gevonden: 0,
    nieuw: 0,
    gewijzigd: 0,
    verdwenen: 0,
    offGewijzigd: 0,
    namenGewist: 0,
    fouten: [],
    status: 'ok',
    boodschap: null,
  };

  try {
    const clubs = (await db.prepare('SELECT guid, naam FROM clubs WHERE actief = 1').all()).results;
    if (clubs.length === 0) {
      return await sluitAf(db, runId, rapport, 'mislukt', 'Geen actieve clubs geconfigureerd.');
    }

    // Alleen teams waarvoor aanduidingen moeten gebeuren.
    const teams = (
      await db
        .prepare('SELECT guid, club_guid, cat_code FROM teams WHERE actief = 1 AND volgen = 1')
        .all()
    ).results;
    if (teams.length === 0) {
      return await sluitAf(db, runId, rapport, 'mislukt', 'Geen ploegen om te volgen.');
    }

    // Categorieën met automatische scope: hun wedstrijden komen vanzelf in de
    // aanduidingslijst. Voor de rest beslist een beheerder of de woensdagregel.
    const autoScope = new Set(
      (await db.prepare('SELECT code FROM categorieen WHERE auto_scope = 1').all())
        .results.map((c) => c.code),
    );
    const gevolgdeTeams = new Map(teams.map((t) => [t.guid, t]));

    // ---- Ophalen ----------------------------------------------------------
    const gevonden = new Map(); // guid -> genormaliseerde wedstrijd
    const geslaagdeClubs = [];

    for (const club of clubs) {
      let rauweLijst;
      try {
        rauweLijst = await clubWedstrijden(club.guid);
      } catch (err) {
        const boodschap = err instanceof VblError ? err.message : String(err);
        rapport.fouten.push(`${club.naam || club.guid}: ${boodschap}`);
        continue;
      }

      geslaagdeClubs.push(club.guid);

      for (const rauw of rauweLijst) {
        const w = normaliseerWedstrijd(rauw);
        if (!w) continue;
        if (w.seizoen !== seizoen) continue;
        // Youth Officials worden enkel thuis ingezet.
        if (!gevolgdeTeams.has(w.thuisGuid)) continue;

        const team = gevolgdeTeams.get(w.thuisGuid);
        w.clubGuid = team.club_guid;
        w.catCode = team.cat_code;
        w.autoScope = autoScope.has(team.cat_code);
        w.hash = await wedstrijdHash(w);
        gevonden.set(w.guid, w);
      }
    }

    rapport.gevonden = gevonden.size;

    if (geslaagdeClubs.length === 0) {
      return await sluitAf(
        db,
        runId,
        rapport,
        'mislukt',
        `Geen enkele club kon opgehaald worden. ${rapport.fouten.join(' | ')}`,
      );
    }

    // ---- Vergelijken ------------------------------------------------------
    const placeholders = geslaagdeClubs.map(() => '?').join(',');
    const bestaande = (
      await db
        .prepare(
          `SELECT guid, wed_id, thuis_guid, thuis_naam, uit_guid, uit_naam, datum, uur,
                  locatie, acc_guid, poule_naam, cat_code, off_aantal, hash, status
             FROM matches
            WHERE seizoen = ? AND club_guid IN (${placeholders})
              AND bron = 'vbl'`,
        )
        .bind(seizoen, ...geslaagdeClubs)
        .all()
    ).results;

    const bestaandeMap = new Map(bestaande.map((r) => [r.guid, r]));

    if (gevonden.size === 0 && bestaande.length > 0) {
      return await sluitAf(
        db,
        runId,
        rapport,
        'mislukt',
        'De API gaf nul wedstrijden terug terwijl er er wel bewaard zijn. Er is niets gewijzigd.',
      );
    }

    const opdrachten = [];
    const wijzigingen = [];

    for (const [guid, w] of gevonden) {
      const oud = bestaandeMap.get(guid);

      if (!oud) {
        rapport.nieuw++;
        opdrachten.push(
          db
            .prepare(
              `INSERT INTO matches (guid, wed_id, seizoen, club_guid, thuis_guid, thuis_naam,
                                    uit_guid, uit_naam, datum, uur, locatie, acc_guid, poule_naam,
                                    cat_code, off_namen, off_aantal, off_gewist,
                                    scope, scope_reden, scope_op, bron, hash,
                                    status, laatst_gezien)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0,
                       ?, ?, ?, 'vbl', ?, 'actief', datetime('now'))`,
            )
            .bind(
              w.guid, w.wedId, w.seizoen, w.clubGuid, w.thuisGuid, w.thuisNaam,
              w.uitGuid, w.uitNaam, w.datum, w.uur, w.locatie, w.accGuid, w.pouleNaam,
              w.catCode, JSON.stringify(w.offNamen), w.offAantal,
              w.autoScope ? 1 : 0,
              w.autoScope ? 'auto' : null,
              w.autoScope ? new Date().toISOString() : null,
              w.hash,
            ),
        );
        wijzigingen.push([guid, 'nieuw', null, null, `${w.datum} ${w.uur} ${w.thuisNaam} - ${w.uitNaam}`]);
        continue;
      }

      const heropgedoken = oud.status === 'verdwenen';

      // De scheidsrechteraanduiding zit bewust niet in de hash: die verandert
      // vaak en mag het wijzigingslogboek niet vervuilen. Ze wordt wel altijd
      // bijgewerkt, want de woensdagregel en de avondcontrole leunen erop.
      const offGewijzigd = (oud.off_aantal ?? 0) !== w.offAantal;
      if (offGewijzigd) {
        rapport.offGewijzigd++;
      }

      if (oud.hash === w.hash && !heropgedoken) {
        opdrachten.push(
          db
            .prepare(
              `UPDATE matches
                  SET off_namen = ?, off_aantal = ?, off_gewist = 0, laatst_gezien = datetime('now')
                WHERE guid = ?`,
            )
            .bind(JSON.stringify(w.offNamen), w.offAantal, guid),
        );
        continue;
      }

      rapport.gewijzigd++;
      opdrachten.push(
        db
          .prepare(
            `UPDATE matches
                SET thuis_naam = ?, uit_guid = ?, uit_naam = ?, datum = ?, uur = ?,
                    locatie = ?, acc_guid = ?, poule_naam = ?, cat_code = ?,
                    off_namen = ?, off_aantal = ?, off_gewist = 0,
                    hash = ?, status = 'actief', laatst_gezien = datetime('now')
              WHERE guid = ?`,
          )
          .bind(
            w.thuisNaam, w.uitGuid, w.uitNaam, w.datum, w.uur, w.locatie, w.accGuid,
            w.pouleNaam, w.catCode, JSON.stringify(w.offNamen), w.offAantal, w.hash, guid,
          ),
      );

      if (heropgedoken) {
        wijzigingen.push([guid, 'gewijzigd', 'status', 'verdwenen', 'actief']);
      }

      const kolomVanVeld = {
        datum: 'datum',
        uur: 'uur',
        thuisNaam: 'thuis_naam',
        uitNaam: 'uit_naam',
        locatie: 'locatie',
      };
      for (const [veld, label] of GEVOLGDE_VELDEN) {
        const oudeWaarde = oud[kolomVanVeld[veld]] ?? '';
        const nieuweWaarde = w[veld] ?? '';
        if (String(oudeWaarde) !== String(nieuweWaarde)) {
          wijzigingen.push([guid, 'gewijzigd', label, String(oudeWaarde), String(nieuweWaarde)]);
        }
      }
    }

    // ---- Verdwenen wedstrijden -------------------------------------------
    const verdwenen = bestaande.filter((r) => r.status === 'actief' && !gevonden.has(r.guid));
    rapport.verdwenen = verdwenen.length;

    let verdwenenVerwerkt = true;
    if (verdwenen.length > DREMPEL_VERDWENEN) {
      verdwenenVerwerkt = false;
      rapport.status = 'deels';
      rapport.boodschap =
        `${verdwenen.length} wedstrijden ontbraken in het antwoord. Dat is meer dan de drempel ` +
        `van ${DREMPEL_VERDWENEN}, dus er is niets als verdwenen gemarkeerd.`;
    } else {
      for (const r of verdwenen) {
        opdrachten.push(
          db.prepare(`UPDATE matches SET status = 'verdwenen' WHERE guid = ?`).bind(r.guid),
        );
        wijzigingen.push([
          r.guid,
          'verdwenen',
          null,
          `${r.datum} ${r.uur} ${r.thuis_naam} - ${r.uit_naam}`,
          null,
        ]);
      }
    }

    for (const [guid, soort, veld, oud, nieuw] of wijzigingen) {
      opdrachten.push(
        db
          .prepare(
            `INSERT INTO match_changes (match_guid, soort, veld, oud, nieuw) VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(guid, soort, veld, oud, nieuw),
      );
    }

    if (opdrachten.length > 0) await db.batch(opdrachten);

    if (rapport.fouten.length > 0 && rapport.status === 'ok') {
      rapport.status = 'deels';
      rapport.boodschap = `Niet alle clubs konden opgehaald worden: ${rapport.fouten.join(' | ')}`;
    }
    if (!verdwenenVerwerkt) rapport.verdwenen = 0;

    // Namen van scheidsrechters wissen vanaf een dag na de wedstrijd. Het
    // aantal blijft staan; dat hebben we nog nodig voor controles en historiek.
    const opkuis = await db
      .prepare(
        `UPDATE matches
            SET off_namen = NULL, off_gewist = 1
          WHERE off_gewist = 0
            AND off_namen IS NOT NULL
            AND bron = 'vbl'
            AND datum < date('now', '-1 day')`,
      )
      .run();
    rapport.namenGewist = opkuis?.meta?.changes ?? 0;

    await zetInstelling(db, 'laatste_sync', new Date().toISOString());

    return await sluitAf(db, runId, rapport, rapport.status, rapport.boodschap);
  } catch (err) {
    return await sluitAf(db, runId, rapport, 'mislukt', `Onverwachte fout: ${err.message}`);
  }
}

async function sluitAf(db, runId, rapport, status, boodschap) {
  rapport.status = status;
  rapport.boodschap = boodschap ?? rapport.boodschap;

  await db
    .prepare(
      `UPDATE sync_runs
          SET geeindigd = datetime('now'), status = ?, aantal_gevonden = ?, aantal_nieuw = ?,
              aantal_gewijzigd = ?, aantal_verdwenen = ?, boodschap = ?
        WHERE id = ?`,
    )
    .bind(
      status,
      rapport.gevonden,
      rapport.nieuw,
      rapport.gewijzigd,
      rapport.verdwenen,
      rapport.boodschap,
      runId,
    )
    .run();

  return rapport;
}
