import { json, fout, leesJson, instelling } from '../../lib/http.js';
import { seizoenscode } from '../../lib/vbl.js';
import { verstuur } from '../../lib/mailer.js';

/**
 * Aanduidingen en beschikbaarheden in bulk vrijgeven.
 *
 * Twee verschillende dingen, bewust gescheiden:
 *
 *  - Een aanduiding wordt op 'vrijgegeven' gezet, niet verwijderd. De rij blijft
 *    bestaan zodat achteraf zichtbaar is dat er iets is teruggedraaid.
 *  - Een beschikbaarheid kent die tussentoestand niet: geen rij betekent 'nog
 *    niet geantwoord'. Vrijgeven is daar dus de rij wissen.
 *
 * Er gaat geen mail naar de betrokken officials — bij dertig aanduidingen
 * tegelijk zou dat dertig mails betekenen voor iets wat meestal een
 * opruimactie is. De beheerders krijgen wel één overzichtsmail.
 */

const MAAND_PATROON = /^\d{4}-\d{2}$/;

/**
 * Bepaalt het datumbereik. Zonder maand: het volledige actieve seizoen.
 * @returns {{van: string, tot: string, omschrijving: string}|null}
 */
function bereik(maand, startJaar) {
  if (!maand) {
    return {
      van: `${startJaar}-07-01`,
      tot: `${Number(startJaar) + 1}-06-30`,
      omschrijving: `seizoen ${startJaar}-${Number(startJaar) + 1}`,
    };
  }

  if (!MAAND_PATROON.test(maand)) return null;

  const [jaar, mnd] = maand.split('-').map(Number);
  if (mnd < 1 || mnd > 12) return null;

  // Laatste dag van de maand: dag 0 van de volgende maand.
  const laatste = new Date(Date.UTC(jaar, mnd, 0)).toISOString().slice(0, 10);

  return { van: `${maand}-01`, tot: laatste, omschrijving: maand };
}

/**
 * POST /api/admin/vrijgeven
 *   { wat: 'aanduidingen' | 'beschikbaarheden' | 'beide',
 *     maand?: 'JJJJ-MM',
 *     uitvoeren?: boolean,
 *     verwittigen?: boolean }
 *
 * Zonder uitvoeren is het een droogloop: je krijgt de aantallen en een
 * voorbeeld terug zonder dat er iets verandert. Dat is bij een actie die
 * tientallen rijen raakt geen luxe.
 */
export async function vrijgeven({ request, env, user }) {
  const body = await leesJson(request);
  const wat = body.wat;
  const uitvoeren = body.uitvoeren === true;

  if (!['aanduidingen', 'beschikbaarheden', 'beide'].includes(wat)) {
    return fout(400, 'Ongeldige aanvraag', "wat moet 'aanduidingen', 'beschikbaarheden' of 'beide' zijn.");
  }

  const startJaar = Number(await instelling(env.DB, 'seizoen_start_jaar', '2026'));
  const seizoen = seizoenscode(startJaar);
  const periode = bereik(body.maand, startJaar);

  if (!periode) return fout(400, 'Ongeldige maand', 'Gebruik de vorm JJJJ-MM.');

  const raaktAanduidingen = wat === 'aanduidingen' || wat === 'beide';
  const raaktBeschikbaarheden = wat === 'beschikbaarheden' || wat === 'beide';

  // ---- Wat zou er geraakt worden --------------------------------------------
  const aanduidingen = raaktAanduidingen
    ? (
        await env.DB.prepare(
          `SELECT a.match_guid, a.user_email, u.voornaam, u.achternaam,
                  m.datum, m.uur, m.thuis_naam, m.uit_naam
             FROM assignments a
             JOIN matches m ON m.guid = a.match_guid
             JOIN users u ON u.email = a.user_email
            WHERE a.status = 'toegewezen'
              AND m.seizoen = ?
              AND m.datum BETWEEN ? AND ?
            ORDER BY m.datum, m.uur, u.achternaam COLLATE NOCASE`,
        )
          .bind(seizoen, periode.van, periode.tot)
          .all()
      ).results
    : [];

  const beschikbaarheden = raaktBeschikbaarheden
    ? (
        await env.DB.prepare(
          `SELECT COUNT(*) AS aantal,
                  COUNT(DISTINCT v.user_email) AS officials,
                  COUNT(DISTINCT v.match_guid) AS wedstrijden
             FROM availability v
             JOIN matches m ON m.guid = v.match_guid
            WHERE m.seizoen = ? AND m.datum BETWEEN ? AND ?`,
        )
          .bind(seizoen, periode.van, periode.tot)
          .first()
      )
    : { aantal: 0, officials: 0, wedstrijden: 0 };

  const rapport = {
    wat,
    periode: periode.omschrijving,
    van: periode.van,
    tot: periode.tot,
    uitgevoerd: uitvoeren,
    aantalAanduidingen: aanduidingen.length,
    aantalBeschikbaarheden: beschikbaarheden.aantal ?? 0,
    betrokkenOfficials: new Set(aanduidingen.map((a) => a.user_email)).size,
    wedstrijdenMetBeschikbaarheden: beschikbaarheden.wedstrijden ?? 0,
    aanduidingen: aanduidingen.slice(0, 100).map((a) => ({
      naam: `${a.voornaam} ${a.achternaam}`,
      email: a.user_email,
      wedstrijd: `${a.datum} ${a.uur} ${a.thuis_naam} - ${a.uit_naam}`,
    })),
  };

  if (!uitvoeren) return json(rapport);

  // ---- Uitvoeren -------------------------------------------------------------
  const opdrachten = [];

  if (raaktAanduidingen && aanduidingen.length > 0) {
    // Op 'vrijgegeven' zetten, niet verwijderen: de historiek blijft leesbaar.
    opdrachten.push(
      env.DB.prepare(
        `UPDATE assignments
            SET status = 'vrijgegeven', gewijzigd_op = datetime('now')
          WHERE status = 'toegewezen'
            AND match_guid IN (
              SELECT guid FROM matches
               WHERE seizoen = ? AND datum BETWEEN ? AND ?)`,
      ).bind(seizoen, periode.van, periode.tot),
    );
  }

  if (raaktBeschikbaarheden && (beschikbaarheden.aantal ?? 0) > 0) {
    // Een beschikbaarheid heeft geen tussentoestand: de rij wissen zet iedereen
    // terug op 'nog niet geantwoord'.
    opdrachten.push(
      env.DB.prepare(
        `DELETE FROM availability
          WHERE match_guid IN (
            SELECT guid FROM matches
             WHERE seizoen = ? AND datum BETWEEN ? AND ?)`,
      ).bind(seizoen, periode.van, periode.tot),
    );
  }

  // Eén regel in het logboek, met wie het deed en wat het raakte.
  opdrachten.push(
    env.DB.prepare(
      `INSERT INTO match_changes (match_guid, soort, veld, oud, nieuw)
       VALUES ('*', 'gewijzigd', 'vrijgegeven in bulk', ?, ?)`,
    ).bind(
      `${rapport.aantalAanduidingen} aanduiding(en), ${rapport.aantalBeschikbaarheden} beschikbaarheid(heden)`,
      `${wat} voor ${periode.omschrijving} door ${user.email}`,
    ),
  );

  if (opdrachten.length > 0) await env.DB.batch(opdrachten);

  // ---- Beheerders verwittigen ------------------------------------------------
  if (body.verwittigen !== false && (rapport.aantalAanduidingen > 0 || rapport.aantalBeschikbaarheden > 0)) {
    const { results: beheerders } = await env.DB
      .prepare('SELECT email FROM users WHERE is_admin = 1 AND actief = 1')
      .all();

    const regels = rapport.aanduidingen
      .map((a) => `- ${a.wedstrijd} — ${a.naam}`)
      .join('\n');

    const tekstDelen = [
      `${user.email} heeft ${wat} vrijgegeven voor ${periode.omschrijving}.`,
      '',
      `Aanduidingen vrijgegeven: ${rapport.aantalAanduidingen}`,
      `Beschikbaarheden gewist: ${rapport.aantalBeschikbaarheden}`,
    ];

    if (regels) {
      tekstDelen.push('', 'De betrokken aanduidingen:', regels);
      if (aanduidingen.length > 100) {
        tekstDelen.push(`(en nog ${aanduidingen.length - 100} andere)`);
      }
    }

    tekstDelen.push(
      '',
      'De betrokken officials hebben hierover geen bericht gekregen.',
    );

    await Promise.all(
      beheerders.map((b) =>
        verstuur(env, {
          naar: b.email,
          onderwerp: `Vrijgegeven: ${wat} voor ${periode.omschrijving}`,
          tekst: tekstDelen.join('\n'),
        }).catch(() => ({ verstuurd: false })),
      ),
    );
  }

  return json(rapport);
}

/**
 * GET /api/admin/vrijgeven/maanden
 *
 * De maanden waarin dit seizoen wedstrijden staan, met per maand hoeveel
 * aanduidingen en beschikbaarheden eraan hangen. Zo hoeft een beheerder niet te
 * gokken welke maand hij moet kiezen.
 */
export async function maanden({ env }) {
  const startJaar = Number(await instelling(env.DB, 'seizoen_start_jaar', '2026'));
  const seizoen = seizoenscode(startJaar);

  const { results } = await env.DB.prepare(
    `SELECT substr(m.datum, 1, 7) AS maand,
            COUNT(DISTINCT m.guid) AS wedstrijden,
            (SELECT COUNT(*) FROM assignments a
              JOIN matches mm ON mm.guid = a.match_guid
             WHERE a.status = 'toegewezen' AND substr(mm.datum, 1, 7) = substr(m.datum, 1, 7)
               AND mm.seizoen = m.seizoen) AS aanduidingen,
            (SELECT COUNT(*) FROM availability v
              JOIN matches mm ON mm.guid = v.match_guid
             WHERE substr(mm.datum, 1, 7) = substr(m.datum, 1, 7)
               AND mm.seizoen = m.seizoen) AS beschikbaarheden
       FROM matches m
      WHERE m.seizoen = ?
      GROUP BY maand
      ORDER BY maand`,
  )
    .bind(seizoen)
    .all();

  return json({
    seizoen: `${startJaar}-${Number(startJaar) + 1}`,
    maanden: results,
  });
}
