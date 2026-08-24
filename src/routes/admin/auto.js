import { json, fout, leesJson, instelling } from '../../lib/http.js';
import { seizoenscode } from '../../lib/vbl.js';
import { aantalNodig } from '../../lib/aanduiding.js';
import { plan } from '../../lib/autotoewijzing.js';

/**
 * POST /api/admin/auto   { dagen?: 14, uitvoeren?: false }
 *
 * Standaard een droogloop: je krijgt terug wat er zou gebeuren zonder dat er
 * iets verandert. Pas met uitvoeren: true wordt er weggeschreven. Die volgorde
 * is opzettelijk — een automaat die meteen twintig mensen inplant zonder dat
 * iemand het gezien heeft, verlies je snel het vertrouwen in.
 */
export async function automatisch({ request, env, user }) {
  const body = await leesJson(request).catch(() => ({}));
  const dagen = Math.min(Math.max(Number(body.dagen ?? 14) || 14, 1), 120);
  const uitvoeren = body.uitvoeren === true;

  const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));
  const vandaag = new Date().toISOString().slice(0, 10);
  const tot = new Date(Date.now() + dagen * 86400000).toISOString().slice(0, 10);

  // ---- Wedstrijden die nog aanvulling nodig hebben -------------------------
  const { results: rijen } = await env.DB.prepare(
    `SELECT m.guid, m.datum, m.uur, m.acc_guid, m.off_aantal, m.club_guid,
            m.thuis_naam, m.uit_naam, cat.groep AS cat_groep,
            (SELECT COUNT(*) FROM assignments a
              WHERE a.match_guid = m.guid AND a.status = 'toegewezen') AS bezet
       FROM matches m
       LEFT JOIN categorieen cat ON cat.code = m.cat_code
      WHERE m.seizoen = ? AND m.status = 'actief' AND m.scope = 1
        AND m.datum >= ? AND m.datum <= ?
      ORDER BY m.datum, m.uur`,
  )
    .bind(seizoen, vandaag, tot)
    .all();

  const wedstrijden = rijen
    .map((r) => ({
      guid: r.guid,
      datum: r.datum,
      uur: r.uur,
      accGuid: r.acc_guid,
      clubGuid: r.club_guid,
      catGroep: r.cat_groep,
      omschrijving: `${r.datum} ${r.uur} ${r.thuis_naam} - ${r.uit_naam}`,
      nodig: aantalNodig(r.off_aantal),
      bezet: r.bezet,
    }))
    .filter((w) => w.nodig > w.bezet);

  if (wedstrijden.length === 0) {
    return json({
      dagen,
      uitgevoerd: false,
      aantalToegewezen: 0,
      aantalOnvolledig: 0,
      toewijzingen: [],
      onvolledig: [],
      boodschap: 'Alle wedstrijden in dit venster zijn al volledig aangeduid.',
    });
  }

  const guids = wedstrijden.map((w) => w.guid);
  const gaten = guids.map(() => '?').join(',');

  // ---- Wie zich beschikbaar zette, met naam en profiel ---------------------
  const { results: vrij } = await env.DB.prepare(
    `SELECT v.match_guid, u.email, u.voornaam, u.achternaam, u.profiel, u.club_guid
       FROM availability v
       JOIN users u ON u.email = v.user_email
      WHERE v.match_guid IN (${gaten}) AND v.status = 'ja' AND u.actief = 1`,
  )
    .bind(...guids)
    .all();

  const naam = new Map();
  const kandidaten = new Map();
  const perWedstrijd = new Map(wedstrijden.map((w) => [w.guid, w]));

  for (const r of vrij) {
    const w = perWedstrijd.get(r.match_guid);
    if (!w) continue;
    // Dezelfde grenzen als bij handmatig toewijzen: eigen club, en een YO ziet
    // alleen U10/U12.
    if (r.club_guid && r.club_guid !== w.clubGuid) continue;
    if (r.profiel === 'YO' && w.catGroep !== 'U10U12') continue;

    naam.set(r.email, `${r.voornaam} ${r.achternaam}`);
    kandidaten.set(r.match_guid, [...(kandidaten.get(r.match_guid) ?? []), r.email]);
  }

  // ---- Huidige belasting en agenda per official ----------------------------
  const { results: bestaand } = await env.DB.prepare(
    `SELECT a.user_email, m.guid, m.datum, m.uur, m.acc_guid
       FROM assignments a
       JOIN matches m ON m.guid = a.match_guid
      WHERE a.status = 'toegewezen' AND m.status = 'actief' AND m.seizoen = ?`,
  )
    .bind(seizoen)
    .all();

  const telling = new Map();
  const agenda = new Map();
  for (const r of bestaand) {
    telling.set(r.user_email, (telling.get(r.user_email) ?? 0) + 1);
    agenda.set(r.user_email, [
      ...(agenda.get(r.user_email) ?? []),
      { guid: r.guid, datum: r.datum, uur: r.uur, accGuid: r.acc_guid },
    ]);
  }

  // ---- Plannen -------------------------------------------------------------
  const resultaat = plan({ wedstrijden, kandidaten, telling, agenda });

  if (uitvoeren && resultaat.toewijzingen.length > 0) {
    await env.DB.batch(
      resultaat.toewijzingen.map((t) =>
        env.DB
          .prepare(
            `INSERT INTO assignments (match_guid, user_email, status, toegewezen_door, toegewezen_op, gewijzigd_op)
             VALUES (?, ?, 'toegewezen', ?, datetime('now'), datetime('now'))
             ON CONFLICT (match_guid, user_email) DO UPDATE
               SET status = 'toegewezen', toegewezen_door = excluded.toegewezen_door,
                   gewijzigd_op = datetime('now')`,
          )
          .bind(t.guid, t.email, `${user.email} (automatisch)`),
      ),
    );
  }

  const omschrijving = new Map(wedstrijden.map((w) => [w.guid, w.omschrijving]));

  return json({
    dagen,
    uitgevoerd: uitvoeren,
    aantalToegewezen: resultaat.aantalToegewezen,
    aantalOnvolledig: resultaat.aantalOnvolledig,
    toewijzingen: resultaat.toewijzingen.map((t) => ({
      guid: t.guid,
      email: t.email,
      naam: naam.get(t.email) ?? t.email,
      wedstrijd: omschrijving.get(t.guid),
    })),
    onvolledig: resultaat.onvolledig.map((o) => ({
      ...o,
      wedstrijd: omschrijving.get(o.guid),
    })),
    verdeling: resultaat.verdeling
      .filter((v) => naam.has(v.email) || v.aantal > 0)
      .map((v) => ({ ...v, naam: naam.get(v.email) ?? v.email })),
  });
}
