import { json, fout, leesJson, instelling } from '../../lib/http.js';
import { seizoenscode } from '../../lib/vbl.js';
import { log } from '../../lib/logboek.js';
import { verwittig, verwittigExtern } from '../../lib/verwittigen.js';
import {
  maandBereik, maandVan, magAfsluiten, bouwRegels, perOfficial, alsBedrag,
} from '../../lib/vergoeding.js';

/**
 * Facturatie.
 *
 * De maand afsluiten legt de bedragen vast. Daarna wijzigen ze niet meer: wat
 * er nadien nog verandert aan de aanduidingen van die maand, komt als correctie
 * in de eerstvolgende afsluiting. Dat is boekhoudkundig de juiste weg en het
 * voorkomt dat een bedrag verandert nadat er al betaald is.
 */

/**
 * Verzamelt wat er in een af te sluiten maand hoort, plus de correcties op
 * eerder afgesloten maanden.
 */
async function berekenMaand(env, maand) {
  const bereik = maandBereik(maand);
  if (!bereik) return { fout: 'Ongeldige maand. Gebruik JJJJ-MM.' };

  const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));

  // ---- Werk in de maand zelf ----------------------------------------------
  // Alleen gespeelde wedstrijden: de datum moet voorbij zijn. Een verdwenen
  // wedstrijd telt niet automatisch mee, maar wordt apart gemeld.
  const { results: rijen } = await env.DB.prepare(
    `SELECT a.match_guid, a.user_email, m.datum, m.status AS wedstrijd_status,
            m.thuis_naam, m.uit_naam, m.cat_code,
            u.voornaam, u.achternaam,
            c.label AS cat_label, c.tarief_cent
       FROM assignments a
       JOIN matches m ON m.guid = a.match_guid
       JOIN users u ON u.email = a.user_email
       LEFT JOIN categorieen c ON c.code = m.cat_code
      WHERE a.status = 'toegewezen'
        AND m.seizoen = ?
        AND m.datum BETWEEN ? AND ?
      ORDER BY m.datum, u.achternaam COLLATE NOCASE`,
  )
    .bind(seizoen, bereik.van, bereik.tot)
    .all();

  const teVergoeden = [];
  const zonderTarief = [];
  const verdwenen = [];

  for (const r of rijen) {
    const naam = `${r.voornaam} ${r.achternaam}`;
    const omschrijving = `${r.datum} ${r.thuis_naam} - ${r.uit_naam}`;

    if (r.tarief_cent === null || r.tarief_cent === undefined) {
      // Een categorie zonder tarief kan niet berekend worden. Op nul zetten zou
      // stil verkeerd zijn; melden en de afsluiting tegenhouden is eerlijker.
      zonderTarief.push({ naam, omschrijving, catCode: r.cat_code ?? '(geen)' });
      continue;
    }

    if (r.wedstrijd_status !== 'actief') {
      // Verdwenen uit de kalender. Niet automatisch meetellen — er is misschien
      // niet gefloten — maar wel tonen zodat een beheerder kan oordelen.
      verdwenen.push({ naam, omschrijving, email: r.user_email, matchGuid: r.match_guid });
      continue;
    }

    teVergoeden.push({
      matchGuid: r.match_guid,
      email: r.user_email,
      naam,
      catCode: r.cat_code,
      catLabel: r.cat_label,
      tariefCent: r.tarief_cent,
    });
  }

  // ---- Correcties op eerder afgesloten maanden ----------------------------
  const { results: eerder } = await env.DB.prepare(
    `SELECT v.match_guid, v.user_email, v.maand AS verwerkt_in, v.cat_code,
            v.tarief_cent, v.aantal AS verwerkt_aantal,
            m.datum, m.status AS wedstrijd_status,
            a.status AS aanduiding_status,
            u.voornaam, u.achternaam,
            c.label AS cat_label
       FROM vergoeding_verwerkt v
       LEFT JOIN matches m ON m.guid = v.match_guid
       LEFT JOIN assignments a ON a.match_guid = v.match_guid AND a.user_email = v.user_email
       LEFT JOIN users u ON u.email = v.user_email
       LEFT JOIN categorieen c ON c.code = v.cat_code
      WHERE v.maand != ?`,
  )
    .bind(maand)
    .all();

  // Per wedstrijd en official optellen wat er al verwerkt is.
  const verwerkt = new Map();
  for (const r of eerder) {
    const s = `${r.match_guid}|${r.user_email}`;
    const bestaand = verwerkt.get(s) ?? { ...r, saldo: 0, betreftMaand: r.datum ? maandVan(r.datum) : r.verwerkt_in };
    bestaand.saldo += r.verwerkt_aantal;
    verwerkt.set(s, bestaand);
  }

  const correcties = [];
  for (const [, r] of verwerkt) {
    // Wat zou het nu moeten zijn? Eén als de aanduiding nog staat en de
    // wedstrijd nog actief is, anders nul.
    const hoort = r.aanduiding_status === 'toegewezen' && r.wedstrijd_status === 'actief' ? 1 : 0;
    const verschil = hoort - r.saldo;
    if (verschil === 0) continue;

    correcties.push({
      matchGuid: r.match_guid,
      email: r.user_email,
      naam: r.voornaam ? `${r.voornaam} ${r.achternaam}` : r.user_email,
      betreftMaand: r.betreftMaand,
      catCode: r.cat_code,
      catLabel: r.cat_label,
      tariefCent: r.tarief_cent,
      aantal: verschil,
    });
  }

  // Aanduidingen op afgesloten maanden die nog nooit verwerkt zijn: ook een
  // correctie, maar dan positief.
  const { results: afgesloten } = await env.DB.prepare(
    'SELECT maand FROM afgesloten_maanden',
  ).all();
  const afgeslotenMaanden = new Set(afgesloten.map((a) => a.maand));

  if (afgeslotenMaanden.size > 0) {
    const { results: nieuw } = await env.DB.prepare(
      `SELECT a.match_guid, a.user_email, m.datum, m.cat_code,
              u.voornaam, u.achternaam, c.label AS cat_label, c.tarief_cent
         FROM assignments a
         JOIN matches m ON m.guid = a.match_guid
         JOIN users u ON u.email = a.user_email
         LEFT JOIN categorieen c ON c.code = m.cat_code
        WHERE a.status = 'toegewezen' AND m.status = 'actief' AND m.seizoen = ?
          AND m.datum < ?`,
    )
      .bind(seizoen, bereik.van)
      .all();

    for (const r of nieuw) {
      const maandVanWedstrijd = maandVan(r.datum);
      if (!afgeslotenMaanden.has(maandVanWedstrijd)) continue;
      if (verwerkt.has(`${r.match_guid}|${r.user_email}`)) continue;
      if (r.tarief_cent === null) continue;

      correcties.push({
        matchGuid: r.match_guid,
        email: r.user_email,
        naam: `${r.voornaam} ${r.achternaam}`,
        betreftMaand: maandVanWedstrijd,
        catCode: r.cat_code,
        catLabel: r.cat_label,
        tariefCent: r.tarief_cent,
        aantal: 1,
      });
    }
  }

  const regels = bouwRegels(teVergoeden, correcties);
  const officials = perOfficial(regels);

  return {
    maand,
    seizoen,
    regels,
    officials,
    teVergoeden,
    correcties,
    zonderTarief,
    verdwenen,
    totaalCent: regels.reduce((s, r) => s + r.bedragCent, 0),
  };
}

/** GET /api/admin/facturatie — status en wat er klaarstaat. */
export async function overzicht({ url, env }) {
  const vandaag = new Date().toISOString().slice(0, 10);
  const seizoen = seizoenscode(Number(await instelling(env.DB, 'seizoen_start_jaar', '2026')));

  const { results: afgesloten } = await env.DB.prepare(
    `SELECT maand, afgesloten_op, afgesloten_door, totaal_cent, aantal_officials,
            verstuurd_op, verstuurd_naar
       FROM afgesloten_maanden ORDER BY maand DESC`,
  ).all();

  // Welke maanden hebben werk maar zijn nog niet afgesloten?
  const { results: maanden } = await env.DB.prepare(
    `SELECT substr(m.datum, 1, 7) AS maand, COUNT(*) AS aanduidingen
       FROM assignments a
       JOIN matches m ON m.guid = a.match_guid
      WHERE a.status = 'toegewezen' AND m.seizoen = ?
      GROUP BY maand ORDER BY maand`,
  )
    .bind(seizoen)
    .all();

  const afgeslotenSet = new Set(afgesloten.map((a) => a.maand));
  const open = maanden
    .filter((m) => !afgeslotenSet.has(m.maand))
    .map((m) => ({ ...m, ...magAfsluiten(m.maand, vandaag) }));

  return json({
    seizoen,
    ontvangers: await instelling(env.DB, 'facturatie_ontvangers', ''),
    afgesloten: afgesloten.map((a) => ({
      maand: a.maand,
      afgeslotenOp: a.afgesloten_op,
      afgeslotenDoor: a.afgesloten_door,
      totaalCent: a.totaal_cent,
      totaal: alsBedrag(a.totaal_cent),
      aantalOfficials: a.aantal_officials,
      verstuurdOp: a.verstuurd_op,
      verstuurdNaar: a.verstuurd_naar,
    })),
    open,
  });
}

/** GET /api/admin/facturatie/voorbeeld?maand=JJJJ-MM — droogloop. */
export async function voorbeeld({ url, env }) {
  const maand = url.searchParams.get('maand');
  const bestaat = await env.DB.prepare('SELECT maand FROM afgesloten_maanden WHERE maand = ?')
    .bind(maand)
    .first();

  if (bestaat) return fout(409, 'Al afgesloten', `${maand} is al afgesloten.`);

  const berekend = await berekenMaand(env, maand);
  if (berekend.fout) return fout(400, 'Ongeldige maand', berekend.fout);

  return json({
    maand,
    aantalOfficials: berekend.officials.length,
    totaalCent: berekend.totaalCent,
    totaal: alsBedrag(berekend.totaalCent),
    officials: berekend.officials.map((o) => ({
      ...o,
      totaal: alsBedrag(o.totaalCent),
      regels: o.regels.map((r) => ({ ...r, bedrag: alsBedrag(r.bedragCent) })),
    })),
    zonderTarief: berekend.zonderTarief,
    verdwenen: berekend.verdwenen,
    aantalCorrecties: berekend.correcties.length,
    kanAfsluiten: berekend.zonderTarief.length === 0,
  });
}

/** POST /api/admin/facturatie/afsluiten   { maand, versturen? } */
export async function afsluiten({ request, env, user }) {
  const body = await leesJson(request);
  const maand = body.maand;
  const vandaag = new Date().toISOString().slice(0, 10);

  const mag = magAfsluiten(maand, vandaag);
  if (!mag.mag) return fout(409, 'Nog niet af te sluiten', mag.reden);

  const bestaat = await env.DB.prepare('SELECT maand FROM afgesloten_maanden WHERE maand = ?')
    .bind(maand)
    .first();
  if (bestaat) return fout(409, 'Al afgesloten', `${maand} is al afgesloten.`);

  const berekend = await berekenMaand(env, maand);
  if (berekend.fout) return fout(400, 'Ongeldige maand', berekend.fout);

  if (berekend.zonderTarief.length > 0) {
    return fout(
      409,
      'Categorie zonder tarief',
      `${berekend.zonderTarief.length} aanduiding(en) staan op een categorie zonder tarief ` +
        `(${[...new Set(berekend.zonderTarief.map((z) => z.catCode))].join(', ')}). ` +
        'Vul eerst een tarief in of geef die aanduidingen vrij.',
    );
  }

  const opdrachten = [
    env.DB
      .prepare(
        `INSERT INTO afgesloten_maanden (maand, seizoen, afgesloten_door, totaal_cent, aantal_officials)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(maand, berekend.seizoen, user.email, berekend.totaalCent, berekend.officials.length),
  ];

  for (const r of berekend.regels) {
    opdrachten.push(
      env.DB
        .prepare(
          `INSERT INTO vergoeding_regels
             (maand, user_email, naam, soort, betreft_maand, cat_code, cat_label,
              aantal, tarief_cent, bedrag_cent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(maand, r.email, r.naam, r.soort, r.betreftMaand, r.catCode, r.catLabel,
          r.aantal, r.tariefCent, r.bedragCent),
    );
  }

  // Het spoor van wat er verwerkt is: nodig om latere correcties te kunnen
  // berekenen. Ook de correcties zelf komen erin, anders zou dezelfde
  // rechtzetting elke maand opnieuw opduiken.
  for (const w of berekend.teVergoeden) {
    opdrachten.push(
      env.DB
        .prepare(
          `INSERT INTO vergoeding_verwerkt (match_guid, user_email, maand, cat_code, tarief_cent, aantal)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT (match_guid, user_email, maand) DO NOTHING`,
        )
        .bind(w.matchGuid, w.email, maand, w.catCode, w.tariefCent),
    );
  }

  for (const c of berekend.correcties) {
    opdrachten.push(
      env.DB
        .prepare(
          `INSERT INTO vergoeding_verwerkt (match_guid, user_email, maand, cat_code, tarief_cent, aantal)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (match_guid, user_email, maand) DO UPDATE SET aantal = excluded.aantal`,
        )
        .bind(c.matchGuid, c.email, maand, c.catCode, c.tariefCent, c.aantal),
    );
  }

  await env.DB.batch(opdrachten);

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'facturatie',
    wie: user.email,
    veld: `maand ${maand} afgesloten`,
    nieuw: `${berekend.officials.length} officials, ${alsBedrag(berekend.totaalCent)}` +
      (berekend.correcties.length ? `, ${berekend.correcties.length} correctie(s)` : ''),
  });

  let verzending = null;
  if (body.versturen !== false) {
    verzending = await verstuurOverzichten(env, maand, berekend);
  }

  return json({
    maand,
    aantalOfficials: berekend.officials.length,
    totaalCent: berekend.totaalCent,
    totaal: alsBedrag(berekend.totaalCent),
    aantalCorrecties: berekend.correcties.length,
    verzending,
  });
}

/** Elke official zijn eigen overzicht, plus de verzamelstaat naar de ontvangers. */
async function verstuurOverzichten(env, maand, berekend) {
  for (const o of berekend.officials) {
    const regels = o.regels
      .map((r) => {
        const wat = r.soort === 'correctie'
          ? `correctie ${r.betreftMaand}: ${r.aantal > 0 ? '+' : ''}${r.aantal} × ${r.catLabel ?? r.catCode}`
          : `${r.aantal} × ${r.catLabel ?? r.catCode}`;
        return `  ${wat} — ${alsBedrag(r.bedragCent)}`;
      })
      .join('\n');

    await verwittig(env, o.email, {
      onderwerp: `Je vergoeding voor ${maand}`,
      tekst:
        `Hallo ${o.naam.split(' ')[0]},\n\n` +
        `Overzicht van je vergoeding voor ${maand}:\n\n${regels}\n\n` +
        `Totaal: ${alsBedrag(o.totaalCent)}\n\n` +
        'Je vindt dit ook terug in YOAssist bij Vergoeding.',
    }).catch(() => ({ mail: false }));
  }

  const ruw = await instelling(env.DB, 'facturatie_ontvangers', '');
  const ontvangers = ruw.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);

  if (ontvangers.length > 0) {
    const lijst = berekend.officials
      .map((o) => `${o.naam}: ${o.aantalWedstrijden} × — ${alsBedrag(o.totaalCent)}`)
      .join('\n');

    // Externe ontvangers: geen gebruikers, dus geen voorkeuren om toe te passen.
    await verwittigExtern(env, ontvangers, {
      onderwerp: `Verzamelstaat vergoedingen ${maand}`,
      tekst:
        `Vergoedingen voor ${maand}, ${berekend.officials.length} officials:\n\n${lijst}\n\n` +
        `Totaal: ${alsBedrag(berekend.totaalCent)}` +
        (berekend.correcties.length
          ? `\n\nBevat ${berekend.correcties.length} correctie(s) op eerdere maanden.`
          : ''),
    });
  }

  const nu = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE afgesloten_maanden SET verstuurd_op = ?, verstuurd_naar = ? WHERE maand = ?',
  )
    .bind(nu, ontvangers.join(', ') || null, maand)
    .run();

  return { officials: berekend.officials.length, ontvangers: ontvangers.length };
}

/** GET /api/admin/facturatie/staat?maand=JJJJ-MM — een bewaarde verzamelstaat. */
export async function staat({ url, env }) {
  const maand = url.searchParams.get('maand');

  const kop = await env.DB.prepare('SELECT * FROM afgesloten_maanden WHERE maand = ?')
    .bind(maand)
    .first();
  if (!kop) return fout(404, 'Niet afgesloten', `${maand} is niet afgesloten.`);

  const { results } = await env.DB.prepare(
    `SELECT * FROM vergoeding_regels WHERE maand = ?
      ORDER BY naam COLLATE NOCASE, soort DESC, betreft_maand, cat_code`,
  )
    .bind(maand)
    .all();

  const officials = perOfficial(
    results.map((r) => ({
      email: r.user_email,
      naam: r.naam,
      soort: r.soort,
      betreftMaand: r.betreft_maand,
      catCode: r.cat_code,
      catLabel: r.cat_label,
      aantal: r.aantal,
      tariefCent: r.tarief_cent,
      bedragCent: r.bedrag_cent,
    })),
  );

  return json({
    maand,
    afgeslotenOp: kop.afgesloten_op,
    afgeslotenDoor: kop.afgesloten_door,
    verstuurdOp: kop.verstuurd_op,
    verstuurdNaar: kop.verstuurd_naar,
    totaalCent: kop.totaal_cent,
    totaal: alsBedrag(kop.totaal_cent),
    officials: officials.map((o) => ({
      ...o,
      totaal: alsBedrag(o.totaalCent),
      regels: o.regels.map((r) => ({ ...r, bedrag: alsBedrag(r.bedragCent) })),
    })),
  });
}

/** POST /api/admin/facturatie/ontvangers   { ontvangers } */
export async function zetOntvangers({ request, env, user }) {
  const body = await leesJson(request);
  const ruw = String(body.ontvangers ?? '');

  const adressen = ruw.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
  const ongeldig = adressen.filter((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(a));

  if (ongeldig.length > 0) {
    return fout(400, 'Ongeldig adres', `Controleer: ${ongeldig.join(', ')}.`);
  }

  await env.DB.prepare(
    `INSERT INTO settings (sleutel, waarde, gewijzigd)
     VALUES ('facturatie_ontvangers', ?, datetime('now'))
     ON CONFLICT (sleutel) DO UPDATE SET waarde = excluded.waarde, gewijzigd = datetime('now')`,
  )
    .bind(adressen.join(', '))
    .run();

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'facturatie',
    wie: user.email,
    veld: 'ontvangers verzamelstaat',
    nieuw: adressen.join(', ') || '(geen)',
  });

  return json({ ontvangers: adressen });
}


/**
 * GET /api/admin/facturatie/officials — per official over alle afgesloten maanden.
 *
 * De verzamelstaten staan per maand; dit is dezelfde gegevens de andere kant op
 * bekeken. Handig bij de vraag 'hoeveel heeft die er dit seizoen gefloten', die
 * anders vijf staten opendoen betekent.
 */
export async function perOfficialOverzicht({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT user_email, naam,
            SUM(aantal) AS aantal,
            SUM(bedrag_cent) AS bedrag_cent,
            COUNT(DISTINCT maand) AS maanden,
            MAX(maand) AS laatste_maand
       FROM vergoeding_regels
      GROUP BY user_email
      ORDER BY naam COLLATE NOCASE`,
  ).all();

  const { results: perMaand } = await env.DB.prepare(
    `SELECT user_email, maand, SUM(bedrag_cent) AS bedrag_cent, SUM(aantal) AS aantal
       FROM vergoeding_regels
      GROUP BY user_email, maand
      ORDER BY maand DESC`,
  ).all();

  const maandenPer = new Map();
  for (const r of perMaand) {
    maandenPer.set(r.user_email, [
      ...(maandenPer.get(r.user_email) ?? []),
      { maand: r.maand, aantal: r.aantal, bedragCent: r.bedrag_cent, bedrag: alsBedrag(r.bedrag_cent) },
    ]);
  }

  return json({
    officials: results.map((r) => ({
      email: r.user_email,
      naam: r.naam,
      aantal: r.aantal,
      bedragCent: r.bedrag_cent,
      bedrag: alsBedrag(r.bedrag_cent),
      maanden: r.maanden,
      laatsteMaand: r.laatste_maand,
      perMaand: maandenPer.get(r.user_email) ?? [],
    })),
    totaalCent: results.reduce((s, r) => s + r.bedrag_cent, 0),
    totaal: alsBedrag(results.reduce((s, r) => s + r.bedrag_cent, 0)),
  });
}
