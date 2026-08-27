/**
 * YOAssist — Worker met static assets.
 *
 * Één project doet nu alles: de statische app, de API en de geplande
 * synchronisatie. Requests waarvoor een bestand in public/ bestaat worden door
 * Cloudflare rechtstreeks bediend en bereiken deze code niet; al de rest komt
 * hier binnen, en dat is in de praktijk /api/*.
 */

import { identify, AuthError } from './lib/access.js';
import { json, fout } from './lib/http.js';
import { synchroniseer } from './lib/sync.js';
import { pasWoensdagregelToe, zoekOverbodigeScope } from './lib/woensdag.js';
import { instelling } from './lib/http.js';
import { seizoenscode } from './lib/vbl.js';
import { aantalNodig, opkomstUur } from './lib/aanduiding.js';
import {
  templateHerinnering,
  templateWoensdagregel,
  templateAvondcontrole,
  templateWeekoverzicht,
} from './lib/mailer.js';
import { verwittig, verwittigAllen } from './lib/verwittigen.js';
import { me, clubs, kiesClub, matches, zetBeschikbaarheid, meldProbleem } from './routes/gebruiker.js';
import * as voorkeuren from './routes/voorkeuren.js';
import * as admin from './routes/admin/index.js';
import { diagnoseMatches } from './routes/admin/diagnose.js';
import * as gebruikers from './routes/admin/gebruikers.js';
import { overzicht } from './routes/admin/overzicht.js';
import * as aanduiding from './routes/admin/aanduiding.js';
import * as mail from './routes/admin/mail.js';
import { automatisch } from './routes/admin/auto.js';
import * as wedstrijden from './routes/admin/wedstrijden.js';
import * as vrijgeven from './routes/admin/vrijgeven.js';
import * as logboekRoute from './routes/admin/logboek.js';
import * as resetRoute from './routes/admin/reset.js';
import * as backupRoute from './routes/admin/backup.js';
import * as facturatie from './routes/admin/facturatie.js';
import { vergoeding } from './routes/vergoeding.js';

// ---------------------------------------------------------------------------
// Routetabel. beheer: true betekent dat de route alleen voor admins is.
// Die vlag staat hier, op één plaats, zodat geen enkele route ze kan vergeten.
// ---------------------------------------------------------------------------
const ROUTES = [
  { methode: 'GET',    pad: '/api/me',                 handler: me },
  { methode: 'GET',    pad: '/api/matches',            handler: matches },
  { methode: 'POST',   pad: '/api/availability',       handler: zetBeschikbaarheid },
  { methode: 'GET',    pad: '/api/clubs',              handler: clubs },
  { methode: 'POST',   pad: '/api/club',               handler: kiesClub },
  { methode: 'POST',   pad: '/api/probleem',           handler: meldProbleem },
  { methode: 'GET',    pad: '/api/vergoeding',         handler: vergoeding },

  { methode: 'GET',    pad: '/api/voorkeuren',         handler: voorkeuren.voorkeuren },
  { methode: 'PATCH',  pad: '/api/voorkeuren',         handler: voorkeuren.zetVoorkeuren },
  { methode: 'POST',   pad: '/api/voorkeuren/test',    handler: voorkeuren.testBericht },
  { methode: 'POST',   pad: '/api/push/abonneer',      handler: voorkeuren.abonneer },
  { methode: 'DELETE', pad: '/api/push/abonneer',      handler: voorkeuren.afmelden },

  { methode: 'GET',    pad: '/api/admin/config',       handler: admin.config,          beheer: true },
  { methode: 'POST',   pad: '/api/admin/season',       handler: admin.season,          beheer: true },
  { methode: 'GET',    pad: '/api/admin/resolve-club', handler: admin.resolveClub,     beheer: true },
  { methode: 'POST',   pad: '/api/admin/clubs',        handler: admin.clubToevoegen,   beheer: true },
  { methode: 'PATCH',  pad: '/api/admin/clubs',        handler: admin.clubAanUit,      beheer: true },
  { methode: 'DELETE', pad: '/api/admin/clubs',        handler: admin.clubVerwijderen, beheer: true },
  { methode: 'POST',   pad: '/api/admin/teams',        handler: admin.teamsLaden,      beheer: true },
  { methode: 'PATCH',  pad: '/api/admin/teams',        handler: admin.teamVlaggen,     beheer: true },
  { methode: 'POST',   pad: '/api/admin/teams/volgen', handler: admin.alleTeamsVolgen, beheer: true },
  { methode: 'GET',    pad: '/api/admin/sync',         handler: admin.syncLogboek,     beheer: true },
  { methode: 'POST',   pad: '/api/admin/sync',         handler: admin.syncNu,          beheer: true },
  { methode: 'GET',    pad: '/api/admin/diagnose-matches', handler: diagnoseMatches,   beheer: true },
  { methode: 'GET',    pad: '/api/admin/overzicht',    handler: overzicht,             beheer: true },
  { methode: 'PATCH',  pad: '/api/admin/scope',        handler: aanduiding.zetScope,   beheer: true },
  { methode: 'POST',   pad: '/api/admin/aanduiding',   handler: aanduiding.wijsToe,    beheer: true },
  { methode: 'DELETE', pad: '/api/admin/aanduiding',   handler: aanduiding.geefVrij,   beheer: true },
  { methode: 'PATCH',  pad: '/api/admin/refs-bevestigd', handler: aanduiding.bevestigRefs, beheer: true },
  { methode: 'GET',    pad: '/api/admin/problemen',    handler: aanduiding.problemen,  beheer: true },
  { methode: 'PATCH',  pad: '/api/admin/problemen',    handler: aanduiding.handelProbleemAf, beheer: true },

  { methode: 'GET',    pad: '/api/admin/mail',         handler: mail.config,      beheer: true },
  { methode: 'POST',   pad: '/api/admin/mail',         handler: mail.zetConfig,   beheer: true },
  { methode: 'POST',   pad: '/api/admin/mail/test',    handler: mail.testMail,    beheer: true },
  { methode: 'POST',   pad: '/api/admin/auto',         handler: automatisch,      beheer: true },

  { methode: 'POST',   pad: '/api/admin/wedstrijden',          handler: wedstrijden.voegToe,   beheer: true },
  { methode: 'DELETE', pad: '/api/admin/wedstrijden',          handler: wedstrijden.verwijder, beheer: true },
  { methode: 'GET',    pad: '/api/admin/wedstrijden/template', handler: wedstrijden.template,  beheer: true },
  { methode: 'POST',   pad: '/api/admin/wedstrijden/import',   handler: wedstrijden.importeer, beheer: true },

  { methode: 'GET',    pad: '/api/admin/vrijgeven/maanden', handler: vrijgeven.maanden,   beheer: true },
  { methode: 'POST',   pad: '/api/admin/vrijgeven',         handler: vrijgeven.vrijgeven, beheer: true },

  { methode: 'GET',    pad: '/api/admin/logboek',           handler: logboekRoute.logboek,  beheer: true },
  { methode: 'PATCH',  pad: '/api/admin/logboek',           handler: logboekRoute.handelAf, beheer: true },
  { methode: 'POST',   pad: '/api/admin/logboek/alles',     handler: logboekRoute.handelAllesAf, beheer: true },

  { methode: 'GET',    pad: '/api/admin/reset',             handler: resetRoute.overzichtReset, beheer: true },
  { methode: 'POST',   pad: '/api/admin/reset',             handler: resetRoute.reset,          beheer: true },

  { methode: 'GET',    pad: '/api/admin/backup',            handler: backupRoute.backup, beheer: true },
  { methode: 'GET',    pad: '/api/admin/backup/omvang',     handler: backupRoute.omvang, beheer: true },

  { methode: 'GET',    pad: '/api/admin/facturatie',            handler: facturatie.overzicht,     beheer: true },
  { methode: 'GET',    pad: '/api/admin/facturatie/voorbeeld',  handler: facturatie.voorbeeld,     beheer: true },
  { methode: 'GET',    pad: '/api/admin/facturatie/staat',      handler: facturatie.staat,         beheer: true },
  { methode: 'GET',    pad: '/api/admin/facturatie/officials',  handler: facturatie.perOfficialOverzicht, beheer: true },
  { methode: 'POST',   pad: '/api/admin/facturatie/afsluiten',  handler: facturatie.afsluiten,     beheer: true },
  { methode: 'POST',   pad: '/api/admin/facturatie/ontvangers', handler: facturatie.zetOntvangers, beheer: true },

  { methode: 'GET',    pad: '/api/admin/users',        handler: gebruikers.lijst,      beheer: true },
  { methode: 'POST',   pad: '/api/admin/users',        handler: gebruikers.toevoegen,  beheer: true },
  { methode: 'PATCH',  pad: '/api/admin/users',        handler: gebruikers.wijzigen,   beheer: true },
  { methode: 'DELETE', pad: '/api/admin/users',        handler: gebruikers.verwijderen, beheer: true },
  { methode: 'GET',    pad: '/api/admin/users/template', handler: gebruikers.template,  beheer: true },
  { methode: 'POST',   pad: '/api/admin/users/import', handler: gebruikers.importeer,  beheer: true },
  { methode: 'POST',   pad: '/api/admin/users/welkom', handler: gebruikers.welkom,     beheer: true },
  { methode: 'POST',   pad: '/api/admin/aanmeldmethodes', handler: mail.zetAanmeldMethodes, beheer: true },
];

/** Zoekt de gebruiker op na een geslaagde identificatie. */
async function laadGebruiker(env, identiteit) {
  const rij = await env.DB.prepare(
    `SELECT u.email, u.voornaam, u.achternaam, u.is_admin, u.profiel, u.club_guid, u.actief,
            c.naam AS club_naam
       FROM users u
       LEFT JOIN clubs c ON c.guid = u.club_guid
      WHERE u.email = ?`,
  )
    .bind(identiteit.email)
    .first();

  if (!rij) {
    throw fout(
      403,
      'Niet in de ledenlijst',
      `${identiteit.email} raakt wel door Access maar staat niet in YOAssist.`,
    );
  }
  if (!rij.actief) {
    throw fout(403, 'Account niet actief', 'Neem contact op met een beheerder.');
  }

  return {
    email: rij.email,
    voornaam: rij.voornaam,
    achternaam: rij.achternaam,
    // Weergavenaam wordt hier samengesteld zodat de frontend er niets over hoeft
    // te weten. Sorteren gebeurt altijd op achternaam, voornaam.
    naam: `${rij.voornaam} ${rij.achternaam}`,
    isAdmin: rij.is_admin === 1,
    profiel: rij.profiel,
    clubGuid: rij.club_guid,
    clubNaam: rij.club_naam,
    via: identiteit.via,
  };
}

async function behandelApi(request, env, ctx, url) {
  const kandidaten = ROUTES.filter((r) => r.pad === url.pathname);

  if (kandidaten.length === 0) {
    return fout(404, 'Onbekend eindpunt', `${url.pathname} bestaat niet.`);
  }

  const route = kandidaten.find((r) => r.methode === request.method);
  if (!route) {
    const toegestaan = kandidaten.map((r) => r.methode).join(', ');
    return new Response(
      JSON.stringify({ error: 'Methode niet toegestaan', detail: `Toegestaan: ${toegestaan}` }),
      {
        status: 405,
        headers: { 'Content-Type': 'application/json', Allow: toegestaan, 'Cache-Control': 'no-store' },
      },
    );
  }

  let identiteit;
  try {
    identiteit = await identify(request, env, ctx);
  } catch (err) {
    if (err instanceof Response) return err;
    const boodschap = err instanceof AuthError ? err.message : 'authenticatie mislukt';
    return fout(401, 'Niet aangemeld', boodschap);
  }

  let user;
  try {
    user = await laadGebruiker(env, identiteit);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  if (route.beheer && !user.isAdmin) {
    return fout(403, 'Geen toegang', 'Deze actie is voorbehouden aan beheerders.');
  }

  try {
    return await route.handler({ request, env, ctx, url, user });
  } catch (err) {
    // leesJson en laadGebruiker gooien kant-en-klare Responses.
    if (err instanceof Response) return err;
    console.error(`[YOAssist] ${request.method} ${url.pathname}:`, err);
    return fout(500, 'Er ging iets mis', err.message);
  }
}

// ---------------------------------------------------------------------------
// Planner.
//
// Cloudflare draait cron in UTC en België wisselt tussen UTC+1 en UTC+2. In
// plaats van voor elke taak een eigen cron-uitdrukking te schrijven en die twee
// keer per jaar te zien verschuiven, draait er één cron per uur en beslist deze
// planner wat er in Brussel op dat moment moet gebeuren.
// ---------------------------------------------------------------------------

/** Datum- en tijdsonderdelen zoals ze in Brussel gelden. */
export function brusselsMoment(datum) {
  const delen = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Brussels',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    })
      .formatToParts(datum)
      .map((p) => [p.type, p.value]),
  );

  const dagen = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    uur: Number(delen.hour) % 24,
    weekdag: dagen[delen.weekday],
    datum: `${delen.year}-${delen.month}-${delen.day}`,
  };
}

/**
 * Wat moet er op dit moment gebeuren? Aparte functie zodat de planning
 * getest kan worden zonder de taken zelf uit te voeren.
 */
export function takenVoor({ uur, weekdag }) {
  const taken = [];

  // Synchroniseren om 0, 6, 12 en 18 uur.
  if ([0, 6, 12, 18].includes(uur)) taken.push('sync');

  // Woensdag om 14 uur: wedstrijden van het komende weekend zonder twee
  // scheidsrechters van de bond in de lijst zetten.
  if (weekdag === 3 && uur === 14) taken.push('woensdagregel');

  // Elke avond om 20 uur nakijken of er intussen iets veranderd is.
  if (uur === 20) taken.push('avondcontrole');

  // Maandagochtend om 8 uur: het overzicht van het komende weekend.
  if (weekdag === 1 && uur === 8) taken.push('weekoverzicht');

  // Herinneringen: 's avonds voor morgen, 's ochtends voor vandaag.
  if (uur === 19) taken.push('herinnering-avond');
  if (uur === 7) taken.push('herinnering-ochtend');

  return taken;
}

/** Actieve beheerders, voor wie een taak nog per mail moet bereiken. */
async function beheerAdressen(db) {
  const { results } = await db.prepare('SELECT email FROM users WHERE is_admin = 1 AND actief = 1').all();
  return results.map((r) => r.email);
}

async function mailBeheerders(env, template) {
  const adressen = await beheerAdressen(env.DB);
  const resultaten = await Promise.all(
    adressen.map((naar) => verwittig(env, naar, template).catch(() => ({ mail: false }))),
  );
  return resultaten.filter((r) => r.mail).length;
}

/**
 * @param {string[]} taken
 * @param {object} env
 * @param {Date} tijdstip — het geplande moment, niet de klok van nu. Bij een
 *   vertraagde uitvoering rond middernacht zou de klok het verkeerde weekend
 *   opleveren.
 */
async function voerTakenUit(taken, env, tijdstip) {
  for (const taak of taken) {
    try {
      if (taak === 'sync') {
        const r = await synchroniseer(env.DB, 'cron');
        console.log(
          `[YOAssist] sync ${r.status}: ${r.gevonden} gevonden, ${r.nieuw} nieuw, ` +
            `${r.gewijzigd} gewijzigd, ${r.verdwenen} verdwenen` +
            (r.boodschap ? ` — ${r.boodschap}` : ''),
        );
      }

      if (taak === 'woensdagregel') {
        const r = await pasWoensdagregelToe(env.DB, tijdstip);
        console.log(
          `[YOAssist] woensdagregel: ${r.gescoopt} wedstrijden ` +
            `in de lijst gezet voor ${r.van} tot ${r.tot}`,
        );

        if (r.gescoopt > 0) {
          const { results: yoPlus } = await env.DB
            .prepare("SELECT email FROM users WHERE profiel = 'YO+' AND actief = 1")
            .all();
          await verwittigAllen(env, yoPlus.map((u) => u.email), templateWoensdagregel(r));
        }
      }

      if (taak === 'avondcontrole') {
        const overbodig = await zoekOverbodigeScope(env.DB);
        if (overbodig.length > 0) {
          console.log(
            `[YOAssist] avondcontrole: ${overbodig.length} wedstrijd(en) hebben intussen ` +
              'twee scheidsrechters van de bond: ' +
              overbodig.map((o) => o.omschrijving).join(' | '),
          );
          await mailBeheerders(env, templateAvondcontrole({ wedstrijden: overbodig }));
        }
      }

      if (taak === 'herinnering-avond' || taak === 'herinnering-ochtend') {
        const avond = taak === 'herinnering-avond';
        const dag = new Date(tijdstip.getTime() + (avond ? 86400000 : 0))
          .toISOString().slice(0, 10);

        const { results } = await env.DB.prepare(
          `SELECT a.user_email, u.voornaam, u.herinner_avond, u.herinner_ochtend,
                  m.uur, m.locatie, m.thuis_naam, m.uit_naam
             FROM assignments a
             JOIN matches m ON m.guid = a.match_guid
             JOIN users u ON u.email = a.user_email
            WHERE a.status = 'toegewezen' AND m.status = 'actief'
              AND m.datum = ? AND u.actief = 1
            ORDER BY a.user_email, m.uur`,
        )
          .bind(dag)
          .all();

        // Per persoon groeperen: wie twee wedstrijden fluit krijgt één bericht
        // met allebei erin, niet twee losse.
        const perOfficial = new Map();
        for (const r of results) {
          const wil = avond ? r.herinner_avond === 1 : r.herinner_ochtend === 1;
          if (!wil) continue;
          const lijst = perOfficial.get(r.user_email) ?? { voornaam: r.voornaam, wedstrijden: [] };
          lijst.wedstrijden.push({
            uur: r.uur,
            wedstrijd: `${r.thuis_naam} - ${r.uit_naam}`,
            locatie: r.locatie,
            opkomst: opkomstUur(r.uur) ?? r.uur,
          });
          perOfficial.set(r.user_email, lijst);
        }

        for (const [email, gegevens] of perOfficial) {
          await verwittig(env, email, templateHerinnering({
            naam: gegevens.voornaam,
            wanneer: avond ? 'Morgen' : 'Vandaag',
            wedstrijden: gegevens.wedstrijden,
          })).catch(() => ({ mail: false }));
        }

        if (perOfficial.size > 0) {
          console.log(`[YOAssist] ${taak}: ${perOfficial.size} official(s) verwittigd voor ${dag}`);
        }
      }

      if (taak === 'weekoverzicht') {
        const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));
        const vandaag = tijdstip.toISOString().slice(0, 10);
        const overWeek = new Date(tijdstip.getTime() + 7 * 86400000).toISOString().slice(0, 10);

        const { results: rijen } = await env.DB.prepare(
          `SELECT m.guid, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.off_aantal,
                  cat.groep AS cat_groep,
                  (SELECT COUNT(*) FROM assignments a
                    WHERE a.match_guid = m.guid AND a.status = 'toegewezen') AS bezet
             FROM matches m
             LEFT JOIN categorieen cat ON cat.code = m.cat_code
            WHERE m.seizoen = ? AND m.status = 'actief' AND m.scope = 1
              AND m.datum >= ? AND m.datum <= ?`,
        )
          .bind(seizoen, vandaag, overWeek)
          .all();

        const open = rijen
          .map((r) => ({
            datum: r.datum,
            uur: r.uur,
            thuis: r.thuis_naam,
            uit: r.uit_naam,
            catGroep: r.cat_groep,
            nogNodig: aantalNodig(r.off_aantal) - r.bezet,
          }))
          .filter((r) => r.nogNodig > 0)
          .sort((a, b) => (a.datum + a.uur).localeCompare(b.datum + b.uur));

        const mail = templateWeekoverzicht({
          u10u12: open.filter((r) => r.catGroep === 'U10U12'),
          overig: open.filter((r) => r.catGroep !== 'U10U12'),
          van: vandaag,
          tot: overWeek,
        });
        const aantal = await mailBeheerders(env, mail);
        console.log(`[YOAssist] weekoverzicht verstuurd naar ${aantal} beheerder(s), ${open.length} open`);
      }
    } catch (err) {
      console.error(`[YOAssist] taak ${taak} mislukt:`, err);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return behandelApi(request, env, ctx, url);
    }

    // Vangnet. In de praktijk bedient Cloudflare de bestanden uit public/ al
    // vóór deze Worker draait; dit vangt alleen wat daar doorheen glipt.
    if (env.ASSETS) return env.ASSETS.fetch(request);

    return new Response('Niet gevonden', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const moment = brusselsMoment(new Date(event.scheduledTime));
    const taken = takenVoor(moment);
    if (taken.length === 0) return;

    ctx.waitUntil(voerTakenUit(taken, env, new Date(event.scheduledTime)));
  },
};
