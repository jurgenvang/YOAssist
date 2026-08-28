import { json, fout } from '../../lib/http.js';
import { log } from '../../lib/logboek.js';
import { VERSIE } from '../../versie.js';

/**
 * Backup: één volledige momentopname als JSON.
 *
 * Alles gaat mee, ook de wedstrijden. Die zijn weliswaar opnieuw op te halen
 * bij Basketbal Vlaanderen, maar niet zoals ze er vorig seizoen bij stonden —
 * en juist dat wil je in een backup terugvinden.
 *
 * Twee dingen die in het bestand zelf horen te staan en niet in de bestandsnaam:
 * de schemaversie en het tijdstip. Een backup zonder die twee is over twee jaar
 * een raadsel, en de bestandsnaam overleeft de eerste keer doorsturen niet.
 *
 * Terugzetten is bewust niet gebouwd. Dat is de gevaarlijke helft: één
 * verkeerde klik overschrijft een heel seizoen. Wie moet herstellen, doet dat
 * via de D1-console met dit bestand in de hand.
 */

/**
 * Alle tabellen, in de volgorde waarin ze bij een herstel ingelezen zouden
 * moeten worden: ouders vóór kinderen.
 */
const TABELLEN = [
  'settings',
  'categorieen',
  'clubs',
  'users',
  'push_abonnementen',
  'teams',
  'matches',
  'assignments',
  'availability',
  'problemen',
  'logboek',
  'sync_runs',
];

/** GET /api/admin/backup — het volledige bestand. */
export async function backup({ env, user }) {
  const gegevens = {};
  const tellingen = {};
  const problemen = [];

  for (const tabel of TABELLEN) {
    try {
      const { results } = await env.DB.prepare(`SELECT * FROM ${tabel}`).all();
      gegevens[tabel] = results;
      tellingen[tabel] = results.length;
    } catch (err) {
      // Een tabel die nog niet bestaat mag de hele backup niet tegenhouden.
      // Wel vermelden, anders lijkt het bestand compleet terwijl het dat niet is.
      gegevens[tabel] = [];
      tellingen[tabel] = 0;
      problemen.push({ tabel, reden: err.message });
    }
  }

  const nu = new Date();
  const bestand = {
    yoassist: {
      versie: VERSIE,
      gemaaktOp: nu.toISOString(),
      gemaaktDoor: user.email,
      // Het aantal per tabel bovenaan, zodat je zonder het bestand door te
      // scrollen ziet of het compleet is.
      tellingen,
      totaalRijen: Object.values(tellingen).reduce((s, n) => s + n, 0),
      volgorde: TABELLEN,
      problemen: problemen.length > 0 ? problemen : undefined,
      opmerking:
        'Terugzetten gebeurt handmatig via de D1-console. Lees de tabellen in de ' +
        'volgorde van het veld "volgorde": ouders vóór kinderen.',
    },
    gegevens,
  };

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'backup',
    wie: user.email,
    veld: 'backup gemaakt',
    nieuw: `${bestand.yoassist.totaalRijen} rijen over ${TABELLEN.length} tabellen`,
  });

  const naam = `yoassist-backup-${nu.toISOString().slice(0, 10)}.json`;

  return new Response(JSON.stringify(bestand, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${naam}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * GET /api/admin/backup/omvang — hoeveel er in zou zitten.
 *
 * Los opvraagbaar zodat de knop kan tonen wat je krijgt zonder eerst het hele
 * bestand op te bouwen.
 */
export async function omvang({ env }) {
  const tellingen = {};

  for (const tabel of TABELLEN) {
    const rij = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${tabel}`).first().catch(() => null);
    tellingen[tabel] = rij?.n ?? 0;
  }

  const laatste = await env.DB.prepare(
    "SELECT vastgesteld FROM logboek WHERE soort = 'backup' ORDER BY id DESC LIMIT 1",
  )
    .first()
    .catch(() => null);

  return json({
    tellingen,
    totaalRijen: Object.values(tellingen).reduce((s, n) => s + n, 0),
    laatsteBackup: laatste?.vastgesteld ?? null,
  });
}
