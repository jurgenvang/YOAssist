import { json, fout, leesJson, instelling } from '../../lib/http.js';
import { seizoenscode, wedstrijdbladUrl } from '../../lib/vbl.js';
import { leesCsv, maakCsv, alsBoolean } from '../../lib/csv.js';

/**
 * Handmatig toegevoegde wedstrijden.
 *
 * Bedoeld voor wat niet in de kalender van Basketbal Vlaanderen staat:
 * oefenwedstrijden, toernooien, bekerduels van een andere organisator. Ze
 * krijgen bron = 'handmatig' en worden door de synchronisatie met rust gelaten;
 * anders zouden ze elke nacht als verdwenen gemarkeerd worden omdat de API ze
 * niet kent.
 *
 * Wedstrijden die wél uit de API komen, worden hier nooit zomaar overschreven.
 * Dat kan alleen met een expliciete overwrite-vlag, en dan nog blijven de
 * beschikbaarheden en aanduidingen staan — die horen bij de wedstrijd, niet bij
 * de rij waarmee ze werd aangemaakt.
 */

const CSV_KOLOMMEN = [
  'datum', 'uur', 'thuis_team_guid', 'thuis_naam', 'uit_naam',
  'locatie', 'categorie', 'overwrite',
];

const DATUM_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DATUM_BE = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;
const UUR_PATROON = /^(\d{1,2})[:.h](\d{2})$/;

function normaliseerDatum(waarde) {
  const s = String(waarde ?? '').trim();
  if (DATUM_ISO.test(s)) return s;
  const m = s.match(DATUM_BE);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function normaliseerUur(waarde) {
  const m = String(waarde ?? '').trim().match(UUR_PATROON);
  if (!m) return null;
  const u = Number(m[1]);
  const min = Number(m[2]);
  if (u > 23 || min > 59) return null;
  return `${String(u).padStart(2, '0')}:${m[2]}`;
}

/**
 * Een stabiele sleutel voor een handmatige wedstrijd. Geen willekeurig getal:
 * twee keer hetzelfde bestand inlezen mag geen dubbels opleveren.
 */
async function maakGuid(seizoen, clubGuid, datum, uur, thuisNaam, uitNaam) {
  const bron = [seizoen, clubGuid, datum, uur, thuisNaam, uitNaam].join('|').toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bron));
  const hex = [...new Uint8Array(digest)]
    .slice(0, 10)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `HAND-${seizoen}-${hex}`;
}

async function maakHash(w) {
  const bron = [w.datum, w.uur, w.thuisNaam, w.uitNaam, w.locatie ?? ''].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bron));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Beoordeelt één wedstrijd. Geeft ofwel een klaargemaakte rij terug, ofwel een
 * reden waarom het niet kan. Gedeeld door het formulier en de CSV-import zodat
 * beide exact dezelfde regels volgen.
 */
async function beoordeel(env, ruw, context) {
  const { seizoen, teams, categorieen } = context;

  const datum = normaliseerDatum(ruw.datum);
  if (!datum) return { fout: 'datum onleesbaar (verwacht JJJJ-MM-DD of DD-MM-JJJJ)' };

  const uur = normaliseerUur(ruw.uur);
  if (!uur) return { fout: 'uur onleesbaar (verwacht UU:MM)' };

  const thuisGuid = String(ruw.thuisTeamGuid ?? '').trim();
  const team = teams.get(thuisGuid);
  if (!team) {
    return { fout: `thuisploeg ${thuisGuid || '(leeg)'} is geen gekende ploeg van een actieve club` };
  }

  const uitNaam = String(ruw.uitNaam ?? '').trim();
  if (!uitNaam) return { fout: 'naam van de tegenstander ontbreekt' };

  const thuisNaam = String(ruw.thuisNaam ?? '').trim() || team.naam;

  // Categorie mag overschreven worden; anders die van de ploeg.
  const catCode = String(ruw.categorie ?? '').trim().toUpperCase() || team.cat_code;
  if (catCode && !categorieen.has(catCode)) {
    return { fout: `categorie ${catCode} staat niet in de categorieënlijst` };
  }

  const w = {
    datum,
    uur,
    thuisGuid,
    thuisNaam,
    uitNaam,
    locatie: String(ruw.locatie ?? '').trim() || null,
    catCode: catCode ?? null,
    clubGuid: team.club_guid,
    seizoen,
  };

  w.guid = await maakGuid(seizoen, w.clubGuid, datum, uur, thuisNaam, uitNaam);
  w.hash = await maakHash(w);

  return { wedstrijd: w };
}

/** Haalt de context op die beide routes nodig hebben. */
async function laadContext(env) {
  const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));

  const { results: teamRijen } = await env.DB.prepare(
    `SELECT t.guid, t.naam, t.cat_code, t.club_guid
       FROM teams t
       JOIN clubs c ON c.guid = t.club_guid
      WHERE t.actief = 1 AND c.actief = 1`,
  ).all();

  const { results: catRijen } = await env.DB.prepare('SELECT code FROM categorieen').all();

  return {
    seizoen,
    teams: new Map(teamRijen.map((t) => [t.guid, t])),
    categorieen: new Set(catRijen.map((c) => c.code)),
  };
}

/** Schrijft één wedstrijd weg. Overschrijft nooit zonder toestemming. */
async function bewaar(env, w, { overwrite, door }) {
  const bestaand = await env.DB.prepare(
    'SELECT guid, bron, status FROM matches WHERE guid = ?',
  )
    .bind(w.guid)
    .first();

  if (bestaand && !overwrite) {
    return {
      overgeslagen: true,
      reden:
        bestaand.bron === 'vbl'
          ? 'bestaat al en komt van Basketbal Vlaanderen'
          : 'staat er al in',
    };
  }

  if (bestaand) {
    // Overschrijven raakt de wedstrijdgegevens aan, niet wat eraan hangt:
    // beschikbaarheden en aanduidingen blijven staan.
    await env.DB.prepare(
      `UPDATE matches
          SET thuis_guid = ?, thuis_naam = ?, uit_naam = ?, datum = ?, uur = ?,
              locatie = ?, cat_code = ?, hash = ?, status = 'actief',
              laatst_gezien = datetime('now')
        WHERE guid = ?`,
    )
      .bind(w.thuisGuid, w.thuisNaam, w.uitNaam, w.datum, w.uur, w.locatie, w.catCode, w.hash, w.guid)
      .run();

    await env.DB.prepare(
      `INSERT INTO match_changes (match_guid, soort, veld, oud, nieuw)
       VALUES (?, 'gewijzigd', 'handmatig overschreven', ?, ?)`,
    )
      .bind(w.guid, bestaand.bron, `${w.datum} ${w.uur} ${w.thuisNaam} - ${w.uitNaam} (door ${door})`)
      .run();

    return { overschreven: true, vorigeBron: bestaand.bron };
  }

  await env.DB.prepare(
    `INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                          datum, uur, locatie, cat_code, off_namen, off_aantal, off_gewist,
                          scope, scope_reden, scope_op, bron, hash, status, laatst_gezien)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, 0, ?, ?, ?, 'handmatig', ?, 'actief', datetime('now'))`,
  )
    .bind(
      w.guid, w.seizoen, w.clubGuid, w.thuisGuid, w.thuisNaam, w.uitNaam,
      w.datum, w.uur, w.locatie, w.catCode,
      w.autoScope ? 1 : 0,
      w.autoScope ? 'auto' : null,
      w.autoScope ? new Date().toISOString() : null,
      w.hash,
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO match_changes (match_guid, soort, veld, oud, nieuw)
     VALUES (?, 'nieuw', 'handmatig toegevoegd', NULL, ?)`,
  )
    .bind(w.guid, `${w.datum} ${w.uur} ${w.thuisNaam} - ${w.uitNaam} (door ${door})`)
    .run();

  return { toegevoegd: true };
}

/** POST /api/admin/wedstrijden — één wedstrijd toevoegen. */
export async function voegToe({ request, env, user }) {
  const body = await leesJson(request);
  const context = await laadContext(env);

  const beoordeling = await beoordeel(env, body, context);
  if (beoordeling.fout) return fout(400, 'Kan niet toevoegen', beoordeling.fout);

  const w = beoordeling.wedstrijd;

  // U10/U12 komt automatisch in de beschikbaarhedenlijst, net als bij de sync.
  const auto = await env.DB.prepare(
    'SELECT auto_scope FROM categorieen WHERE code = ?',
  )
    .bind(w.catCode)
    .first();
  w.autoScope = auto?.auto_scope === 1;

  const uitslag = await bewaar(env, w, { overwrite: body.overwrite === true, door: user.email });

  if (uitslag.overgeslagen) return fout(409, 'Bestaat al', uitslag.reden);

  return json({
    guid: w.guid,
    datum: w.datum,
    uur: w.uur,
    thuis: w.thuisNaam,
    uit: w.uitNaam,
    inScope: Boolean(w.autoScope),
    overschreven: Boolean(uitslag.overschreven),
    wedstrijdblad: null, // handmatige wedstrijden staan niet op de VBL-site
  });
}

/** GET /api/admin/wedstrijden/template */
export function template() {
  const csv = maakCsv(CSV_KOLOMMEN, [
    {
      datum: '2026-09-12',
      uur: '14:00',
      thuis_team_guid: 'BVBL1125G12  1',
      thuis_naam: '',
      uit_naam: 'Naam van de tegenstander',
      locatie: 'Sporthal Noord',
      categorie: '',
      overwrite: '0',
    },
  ]);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="yoassist-wedstrijden.csv"',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * POST /api/admin/wedstrijden/import   { csv, uitvoeren? }
 *
 * Droogloop tenzij uitvoeren: true. Een bestaande wedstrijd wordt geweigerd en
 * gemeld, niet stilzwijgend overgeslagen — tenzij die rij overwrite = 1 heeft.
 */
export async function importeer({ request, env, user }) {
  const body = await leesJson(request);
  const uitvoeren = body.uitvoeren === true;

  const { kolommen, rijen } = leesCsv(body.csv);
  if (rijen.length === 0) {
    return fout(400, 'Leeg bestand', 'Er staan geen gegevensregels in dit bestand.');
  }

  const verplicht = ['datum', 'uur', 'thuis_team_guid', 'uit_naam'];
  const ontbrekend = verplicht.filter((k) => !kolommen.includes(k));
  if (ontbrekend.length > 0) {
    return fout(
      400,
      'Kolommen ontbreken',
      `Deze kolom${ontbrekend.length > 1 ? 'men ontbreken' : ' ontbreekt'}: ${ontbrekend.join(', ')}. ` +
        `Verwacht: ${CSV_KOLOMMEN.join(', ')}.`,
    );
  }

  const context = await laadContext(env);
  const autoCodes = new Set(
    (await env.DB.prepare('SELECT code FROM categorieen WHERE auto_scope = 1').all())
      .results.map((c) => c.code),
  );

  const nieuw = [];
  const botsingen = [];
  const fouten = [];
  const gezien = new Set();

  for (const rij of rijen) {
    const regel = rij._regel;

    // De voorbeeldregel uit het sjabloon overslaan.
    if (String(rij.uit_naam ?? '').trim() === 'Naam van de tegenstander') continue;

    const beoordeling = await beoordeel(
      env,
      {
        datum: rij.datum,
        uur: rij.uur,
        thuisTeamGuid: rij.thuis_team_guid,
        thuisNaam: rij.thuis_naam,
        uitNaam: rij.uit_naam,
        locatie: rij.locatie,
        categorie: rij.categorie,
      },
      context,
    );

    if (beoordeling.fout) {
      fouten.push({ regel, reden: beoordeling.fout });
      continue;
    }

    const w = beoordeling.wedstrijd;
    w.autoScope = autoCodes.has(w.catCode);
    w.overwrite = alsBoolean(rij.overwrite);
    w.regel = regel;

    if (gezien.has(w.guid)) {
      fouten.push({ regel, reden: 'zelfde wedstrijd staat twee keer in dit bestand' });
      continue;
    }
    gezien.add(w.guid);

    const bestaand = await env.DB.prepare('SELECT guid, bron FROM matches WHERE guid = ?')
      .bind(w.guid)
      .first();

    if (bestaand && !w.overwrite) {
      botsingen.push({
        regel,
        omschrijving: `${w.datum} ${w.uur} ${w.thuisNaam} - ${w.uitNaam}`,
        reden:
          bestaand.bron === 'vbl'
            ? 'bestaat al en komt van Basketbal Vlaanderen — zet overwrite op 1 om ze toch te vervangen'
            : 'staat er al in — zet overwrite op 1 om ze te vervangen',
      });
      continue;
    }

    nieuw.push({ ...w, vervangt: Boolean(bestaand) });
  }

  if (uitvoeren) {
    for (const w of nieuw) {
      await bewaar(env, w, { overwrite: true, door: user.email });
    }
  }

  return json({
    uitgevoerd: uitvoeren,
    aantalNieuw: nieuw.filter((w) => !w.vervangt).length,
    aantalVervangen: nieuw.filter((w) => w.vervangt).length,
    aantalBotsingen: botsingen.length,
    aantalFouten: fouten.length,
    nieuw: nieuw.map((w) => ({
      regel: w.regel,
      omschrijving: `${w.datum} ${w.uur} ${w.thuisNaam} - ${w.uitNaam}`,
      locatie: w.locatie,
      catCode: w.catCode,
      inScope: Boolean(w.autoScope),
      vervangt: w.vervangt,
    })),
    botsingen,
    fouten,
  });
}

/** DELETE /api/admin/wedstrijden?guid=... — alleen handmatige wedstrijden. */
export async function verwijder({ url, env }) {
  const guid = (url.searchParams.get('guid') ?? '').trim();
  if (!guid) return fout(400, 'Ongeldige aanvraag', 'guid ontbreekt.');

  const bestaand = await env.DB.prepare('SELECT guid, bron FROM matches WHERE guid = ?')
    .bind(guid)
    .first();
  if (!bestaand) return fout(404, 'Onbekende wedstrijd', 'Deze wedstrijd bestaat niet.');

  if (bestaand.bron !== 'handmatig') {
    return fout(
      409,
      'Komt van Basketbal Vlaanderen',
      'Deze wedstrijd wordt bij elke synchronisatie opnieuw opgehaald. Haal ze uit de beschikbaarhedenlijst in plaats van te verwijderen.',
    );
  }

  const aanduidingen = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM assignments WHERE match_guid = ? AND status = 'toegewezen'",
  )
    .bind(guid)
    .first();

  if ((aanduidingen?.n ?? 0) > 0) {
    return fout(
      409,
      'Er staan aanduidingen op',
      'Geef eerst de toegewezen officials vrij; die krijgen dan ook bericht.',
    );
  }

  await env.DB.prepare('DELETE FROM matches WHERE guid = ?').bind(guid).run();
  return json({ guid, verwijderd: true });
}
