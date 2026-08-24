import { json, instelling } from '../../lib/http.js';
import { seizoenscode, wedstrijdbladUrl } from '../../lib/vbl.js';
import { aantalNodig } from '../../lib/aanduiding.js';

/**
 * GET /api/admin/overzicht?dagen=14[&club=BVBL1125]
 *
 * Thuiswedstrijden van de komende N dagen, gesorteerd op datum, uur en
 * ploegnaam, met per wedstrijd:
 *  - de categorie en het tarief
 *  - de scheidsrechters die Basketbal Vlaanderen heeft aangeduid, met naam
 *  - wie zich beschikbaar of niet beschikbaar heeft gezet, met naam
 *  - een link naar het wedstrijdblad
 *
 * Een beheerder ziet standaard alle geconfigureerde clubs, niet enkel die van
 * zijn eigen account: hij beheert de aanduidingen, en die kunnen over meerdere
 * clubs lopen.
 *
 * De eigen toewijzingen komen erbij zodra die module bestaat; de structuur
 * hieronder houdt daar al plaats voor vrij.
 */
export async function overzicht({ url, env }) {
  const dagen = Math.min(Math.max(Number(url.searchParams.get('dagen') ?? 14) || 14, 1), 120);
  const clubFilter = url.searchParams.get('club');
  const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));

  const vandaag = new Date().toISOString().slice(0, 10);
  const tot = new Date(Date.now() + dagen * 86400000).toISOString().slice(0, 10);

  const voorwaarden = [
    'm.seizoen = ?',
    "m.status = 'actief'",
    'm.datum >= ?',
    'm.datum <= ?',
  ];
  const params = [seizoen, vandaag, tot];

  if (clubFilter) {
    voorwaarden.push('m.club_guid = ?');
    params.push(clubFilter.toUpperCase());
  }

  const { results: wedstrijden } = await env.DB.prepare(
    `SELECT m.guid, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.locatie, m.acc_guid,
            m.poule_naam, m.cat_code, m.off_namen, m.off_aantal, m.off_gewist,
            m.club_guid, c.naam AS club_naam,
            m.scope, m.scope_reden, m.scope_uit,
            cat.label AS cat_label, cat.groep AS cat_groep, cat.tarief_cent
       FROM matches m
       LEFT JOIN clubs c ON c.guid = m.club_guid
       LEFT JOIN categorieen cat ON cat.code = m.cat_code
       LEFT JOIN teams t ON t.guid = m.thuis_guid
      WHERE ${voorwaarden.join(' AND ')}
      ORDER BY m.datum, m.uur, m.thuis_naam COLLATE NOCASE`,
  )
    .bind(...params)
    .all();

  if (wedstrijden.length === 0) {
    return json({ dagen, van: vandaag, tot, wedstrijden: [], aantal: 0 });
  }

  // Beschikbaarheden in één keer ophalen in plaats van per wedstrijd. Bij
  // veertien dagen en twintig officials scheelt dat honderden queries.
  const guids = wedstrijden.map((w) => w.guid);
  const plaatshouders = guids.map(() => '?').join(',');
  const { results: antwoorden } = await env.DB.prepare(
    `SELECT a.match_guid, a.status, a.updated_at,
            u.email, u.voornaam, u.achternaam, u.profiel
       FROM availability a
       JOIN users u ON u.email = a.user_email
      WHERE a.match_guid IN (${plaatshouders})
      ORDER BY u.achternaam COLLATE NOCASE, u.voornaam COLLATE NOCASE`,
  )
    .bind(...guids)
    .all();

  // Eigen aanduidingen, ook in één keer.
  const { results: aanduidingen } = await env.DB.prepare(
    `SELECT a.match_guid, a.status, a.toegewezen_door, a.toegewezen_op,
            u.email, u.voornaam, u.achternaam, u.profiel
       FROM assignments a
       JOIN users u ON u.email = a.user_email
      WHERE a.match_guid IN (${plaatshouders}) AND a.status = 'toegewezen'
      ORDER BY u.achternaam COLLATE NOCASE, u.voornaam COLLATE NOCASE`,
  )
    .bind(...guids)
    .all();

  const perToewijzing = new Map();
  for (const a of aanduidingen) {
    const lijst = perToewijzing.get(a.match_guid) ?? [];
    lijst.push({
      email: a.email,
      naam: `${a.voornaam} ${a.achternaam}`,
      profiel: a.profiel,
      toegewezenDoor: a.toegewezen_door,
    });
    perToewijzing.set(a.match_guid, lijst);
  }

  const perWedstrijd = new Map();
  for (const a of antwoorden) {
    const lijst = perWedstrijd.get(a.match_guid) ?? { ja: [], nee: [] };
    lijst[a.status].push({
      email: a.email,
      naam: `${a.voornaam} ${a.achternaam}`,
      profiel: a.profiel,
    });
    perWedstrijd.set(a.match_guid, lijst);
  }

  const uitgewerkt = wedstrijden.map((w) => {
    const antwoord = perWedstrijd.get(w.guid) ?? { ja: [], nee: [] };

    let vblRefs = [];
    try {
      vblRefs = w.off_namen ? JSON.parse(w.off_namen) : [];
    } catch {
      vblRefs = [];
    }

    return {
      guid: w.guid,
      datum: w.datum,
      uur: w.uur,
      thuis: w.thuis_naam,
      uit: w.uit_naam,
      locatie: w.locatie,
      accGuid: w.acc_guid,
      poule: w.poule_naam,
      clubGuid: w.club_guid,
      clubNaam: w.club_naam,
      catCode: w.cat_code,
      catLabel: w.cat_label,
      catGroep: w.cat_groep,
      tariefCent: w.tarief_cent ?? null,
      // Namen worden gewist een dag na de wedstrijd; het aantal blijft. Daarom
      // altijd het aantal tonen en de namen alleen als ze er nog zijn.
      vblAantal: w.off_aantal,
      vblRefs,
      vblNamenGewist: w.off_gewist === 1,
      wedstrijdblad: wedstrijdbladUrl(w.guid),
      beschikbaar: antwoord.ja,
      nietBeschikbaar: antwoord.nee,
      inScope: w.scope === 1,
      scopeReden: w.scope_reden,
      scopeUit: w.scope_uit === 1,
      nodig: aantalNodig(w.off_aantal),
      toegewezen: perToewijzing.get(w.guid) ?? [],
    };
  });

  return json({
    dagen,
    van: vandaag,
    tot,
    aantal: uitgewerkt.length,
    inScope: uitgewerkt.filter((w) => w.inScope).length,
    zonderVblRefs: uitgewerkt.filter((w) => w.vblAantal < 2).length,
    onvolledig: uitgewerkt.filter((w) => w.inScope && w.toegewezen.length < w.nodig).length,
    zonderBeschikbaren: uitgewerkt.filter((w) => w.inScope && w.beschikbaar.length === 0).length,
    wedstrijden: uitgewerkt,
  });
}
