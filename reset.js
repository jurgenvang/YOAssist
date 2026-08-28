import { json, fout, leesJson } from '../../lib/http.js';

/**
 * Het logboek bekijken.
 *
 * GET /api/admin/logboek?categorie=&dagen=&open=1&q=&limiet=
 *
 * Filters zijn optioneel en stapelbaar. Standaard: alles van de laatste dertig
 * dagen, nieuwste eerst.
 *
 * De regels worden hier verrijkt met de wedstrijdgegevens waar ze bij horen.
 * Dat kan niet in het logboek zelf staan: een wedstrijd kan na het loggen nog
 * verplaatst zijn, en dan hoort de lijst het huidige moment te tonen, niet dat
 * van toen.
 */
export async function logboek({ url, env }) {
  const categorie = url.searchParams.get('categorie');
  const dagen = Math.min(Math.max(Number(url.searchParams.get('dagen') ?? 30) || 30, 1), 400);
  const alleenOpen = url.searchParams.get('open') === '1';
  const zoek = (url.searchParams.get('q') ?? '').trim();
  const limiet = Math.min(Math.max(Number(url.searchParams.get('limiet') ?? 200) || 200, 1), 500);

  // Voorwaarden en parameters worden samen opgebouwd en blijven zo in de pas.
  // Genummerde parameters zijn hier een valstrik: één filter erbij en de
  // nummering klopt niet meer.
  const voorwaarden = ["l.vastgesteld >= datetime('now', ?)"];
  const params = [`-${dagen} days`];

  if (categorie) {
    if (!['wedstrijd', 'aanduiding', 'beheer'].includes(categorie)) {
      return fout(400, 'Onbekende categorie', "Kies 'wedstrijd', 'aanduiding' of 'beheer'.");
    }
    voorwaarden.push('l.categorie = ?');
    params.push(categorie);
  }

  if (alleenOpen) voorwaarden.push('l.afgehandeld = 0');

  if (zoek) {
    // Ook op de ploegnamen zoeken: daar zoekt een beheerder in de praktijk op,
    // niet op de tekst van de logregel.
    voorwaarden.push(
      `(l.veld LIKE ? OR l.oud LIKE ? OR l.nieuw LIKE ? OR l.wie LIKE ?
        OR m.thuis_naam LIKE ? OR m.uit_naam LIKE ?)`,
    );
    const patroon = `%${zoek}%`;
    params.push(patroon, patroon, patroon, patroon, patroon, patroon);
  }

  const sql = `
    SELECT l.*, m.datum, m.uur, m.thuis_naam, m.uit_naam, m.status AS wedstrijd_status
      FROM logboek l
      LEFT JOIN matches m ON m.guid = l.match_guid
     WHERE ${voorwaarden.join(' AND ')}
     ORDER BY l.id DESC
     LIMIT ${limiet}`;

  const { results } = await env.DB.prepare(sql).bind(...params).all();

  // Tellers over dezelfde periode, ongeacht de overige filters — zo blijft
  // zichtbaar hoeveel er in elke categorie zit terwijl je er één bekijkt.
  const { results: tellers } = await env.DB.prepare(
    `SELECT categorie, COUNT(*) AS aantal,
            SUM(CASE WHEN afgehandeld = 0 THEN 1 ELSE 0 END) AS open
       FROM logboek
      WHERE vastgesteld >= datetime('now', ?)
      GROUP BY categorie`,
  )
    .bind(`-${dagen} days`)
    .all();

  return json({
    dagen,
    categorie,
    alleenOpen,
    zoek: zoek || null,
    aantal: results.length,
    afgekapt: results.length === limiet,
    tellers: Object.fromEntries(
      tellers.map((t) => [t.categorie, { aantal: t.aantal, open: t.open ?? 0 }]),
    ),
    regels: results.map((r) => ({
      id: r.id,
      categorie: r.categorie,
      soort: r.soort,
      wie: r.wie,
      veld: r.veld,
      oud: r.oud,
      nieuw: r.nieuw,
      vastgesteld: r.vastgesteld,
      afgehandeld: r.afgehandeld === 1,
      matchGuid: r.match_guid,
      wedstrijd: r.datum ? `${r.datum} ${r.uur} ${r.thuis_naam} - ${r.uit_naam}` : null,
      wedstrijdStatus: r.wedstrijd_status,
    })),
  });
}

/**
 * PATCH /api/admin/logboek   { id | ids, afgehandeld }
 *
 * Regels afvinken. Bedoeld voor wedstrijdwijzigingen die opvolging vroegen:
 * een verplaatste wedstrijd waarvan de betrokkenen intussen verwittigd zijn.
 */
export async function handelAf({ request, env }) {
  const body = await leesJson(request);
  const ids = Array.isArray(body.ids) ? body.ids : body.id !== undefined ? [body.id] : [];

  const geldig = ids.map(Number).filter(Number.isInteger);
  if (geldig.length === 0) return fout(400, 'Ongeldige aanvraag', 'Geef id of ids mee.');

  const afgehandeld = body.afgehandeld === false ? 0 : 1;
  const gaten = geldig.map(() => '?').join(',');

  await env.DB.prepare(`UPDATE logboek SET afgehandeld = ? WHERE id IN (${gaten})`)
    .bind(afgehandeld, ...geldig)
    .run();

  return json({ ids: geldig, afgehandeld: afgehandeld === 1 });
}

/**
 * POST /api/admin/logboek/alles-afhandelen   { categorie? }
 *
 * Alles in één keer afvinken. Na een grote synchronisatie is regel voor regel
 * afvinken geen doen.
 */
export async function handelAllesAf({ request, env }) {
  const body = await leesJson(request).catch(() => ({}));
  const categorie = body.categorie;

  if (categorie && !['wedstrijd', 'aanduiding', 'beheer'].includes(categorie)) {
    return fout(400, 'Onbekende categorie', "Kies 'wedstrijd', 'aanduiding' of 'beheer'.");
  }

  const res = await env.DB.prepare(
    `UPDATE logboek SET afgehandeld = 1
      WHERE afgehandeld = 0 ${categorie ? 'AND categorie = ?' : ''}`,
  )
    .bind(...(categorie ? [categorie] : []))
    .run();

  return json({ categorie: categorie ?? 'alle', afgehandeld: res?.meta?.changes ?? 0 });
}
