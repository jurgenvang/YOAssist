import { json, fout, leesJson } from '../../lib/http.js';
import { verwittig } from '../../lib/verwittigen.js';
import { log } from '../../lib/logboek.js';

/**
 * Belangrijk nieuws versturen.
 *
 * Eén mededeling tegelijk: een nieuwe zet de vorige op inactief. De oude blijft
 * wel in `berichten` staan bij wie ze toen kreeg, want dat is precies waar Mijn
 * berichten voor dient.
 *
 * Zoals overal waar iets de deur uitgaat: eerst een droogloop. Dit gaat naar
 * iedereen tegelijk, dus een verkeerde klik is hier duurder dan elders.
 */

/** GET /api/admin/mededeling — de huidige stand. */
export async function huidige({ env }) {
  const actief = await env.DB.prepare(
    `SELECT id, tekst, link, link_tekst, geldig_tot, gezet_door, gezet_op
       FROM mededelingen
      WHERE actief = 1 AND geldig_tot > datetime('now')
      ORDER BY id DESC LIMIT 1`,
  ).first();

  const aantalWeggeklikt = actief
    ? (await env.DB
        .prepare('SELECT COUNT(*) AS n FROM mededeling_gezien WHERE mededeling_id = ?')
        .bind(actief.id)
        .first())?.n ?? 0
    : 0;

  const ontvangers = (await env.DB
    .prepare('SELECT COUNT(*) AS n FROM users WHERE actief = 1')
    .first())?.n ?? 0;

  return json({ mededeling: actief ?? null, aantalWeggeklikt, ontvangers });
}

/**
 * POST /api/admin/mededeling
 *   { tekst, link?, linkTekst?, geldigTot, kanalen?, uitvoeren? }
 */
export async function zet({ request, env, user }) {
  const body = await leesJson(request);
  const uitvoeren = body.uitvoeren === true;

  const tekst = String(body.tekst ?? '').trim();
  if (tekst.length < 3) {
    return fout(400, 'Geen tekst', 'Schrijf wat je wil meedelen.');
  }
  if (tekst.length > 500) {
    return fout(400, 'Te lang', 'Houd het kort; een banner leest niemand als hij vijf regels telt.');
  }

  const geldigTot = String(body.geldigTot ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(geldigTot)) {
    return fout(400, 'Geen einddatum', 'Geef aan tot wanneer dit getoond moet worden.');
  }
  if (new Date(geldigTot) <= new Date()) {
    return fout(400, 'Ligt in het verleden', 'Kies een moment in de toekomst.');
  }

  const link = String(body.link ?? '').trim() || null;
  if (link && !/^https?:\/\//.test(link)) {
    return fout(400, 'Ongeldige link', 'Een link begint met http:// of https://.');
  }

  const { results: ontvangers } = await env.DB
    .prepare('SELECT email FROM users WHERE actief = 1')
    .all();

  if (!uitvoeren) {
    return json({
      uitgevoerd: false,
      aantal: ontvangers.length,
      voorbeeld: { tekst, link, linkTekst: body.linkTekst ?? null, geldigTot },
    });
  }

  // De vorige op inactief: er is er maar één tegelijk zichtbaar.
  await env.DB.prepare('UPDATE mededelingen SET actief = 0 WHERE actief = 1').run();

  const res = await env.DB.prepare(
    `INSERT INTO mededelingen (tekst, link, link_tekst, geldig_tot, gezet_door)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(tekst, link, String(body.linkTekst ?? '').trim() || null, geldigTot, user.email)
    .run();

  const kanalen = body.kanalen ?? 'beide';
  let verstuurd = 0;

  if (kanalen !== 'geen') {
    for (const o of ontvangers) {
      const uitslag = await verwittig(env, o.email, {
        onderwerp: 'Bericht van de club',
        tekst: tekst + (link ? `\n\n${link}` : ''),
        soort: 'nieuws',
        kort: tekst.slice(0, 160),
        url: link ?? '/',
      }).catch(() => ({ mail: false, push: 0 }));

      if (uitslag.mail || uitslag.push > 0) verstuurd++;
    }
  }

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'nieuws',
    wie: user.email,
    veld: 'mededeling geplaatst',
    nieuw: `${tekst.slice(0, 120)} — tot ${geldigTot}, ${verstuurd} verwittigd`,
  });

  return json({
    uitgevoerd: true,
    id: res?.meta?.last_row_id ?? null,
    aantal: ontvangers.length,
    verstuurd,
  });
}

/** DELETE /api/admin/mededeling — de huidige intrekken. */
export async function trekIn({ env, user }) {
  const res = await env.DB.prepare('UPDATE mededelingen SET actief = 0 WHERE actief = 1').run();

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'nieuws',
    wie: user.email,
    veld: 'mededeling ingetrokken',
  });

  return json({ ingetrokken: res?.meta?.changes ?? 0 });
}
