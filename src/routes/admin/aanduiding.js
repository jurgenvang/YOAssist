import { json, fout, leesJson } from '../../lib/http.js';
import { aantalNodig, conflicten, opkomstUur } from '../../lib/aanduiding.js';
import { templateAanduiding, templateVrijgegeven } from '../../lib/mailer.js';
import { verwittig } from '../../lib/verwittigen.js';
import { log, wedstrijdOmschrijving } from '../../lib/logboek.js';

/**
 * PATCH /api/admin/scope   { matchGuid, scope: true|false }
 *
 * Zet een wedstrijd handmatig in of uit de aanduidingslijst. Uitzetten legt
 * scope_uit vast, zodat de woensdagregel ze niet de volgende dag weer
 * binnenhaalt — anders vecht de beheerder tegen de automaat.
 */
export async function zetScope({ request, env, user }) {
  const body = await leesJson(request);
  const guid = typeof body.matchGuid === 'string' ? body.matchGuid.trim() : '';
  if (!guid) return fout(400, 'Ongeldige aanvraag', 'matchGuid ontbreekt.');
  if (typeof body.scope !== 'boolean') {
    return fout(400, 'Ongeldige aanvraag', 'scope moet true of false zijn.');
  }

  const wedstrijd = await env.DB.prepare(
    "SELECT guid, scope FROM matches WHERE guid = ? AND status = 'actief'",
  )
    .bind(guid)
    .first();
  if (!wedstrijd) return fout(404, 'Onbekende wedstrijd', 'Deze wedstrijd bestaat niet of is verdwenen.');

  if (!body.scope) {
    const toegewezen = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM assignments WHERE match_guid = ? AND status = 'toegewezen'",
    )
      .bind(guid)
      .first();
    if ((toegewezen?.n ?? 0) > 0) {
      return fout(
        409,
        'Er zijn al aanduidingen',
        'Geef eerst de toegewezen officials vrij voor je deze wedstrijd uit de lijst haalt.',
      );
    }
  }

  await env.DB.prepare(
    `UPDATE matches
        SET scope = ?, scope_reden = ?, scope_op = ?, scope_uit = ?
      WHERE guid = ?`,
  )
    .bind(
      body.scope ? 1 : 0,
      body.scope ? 'admin' : null,
      body.scope ? new Date().toISOString() : null,
      body.scope ? 0 : 1,
      guid,
    )
    .run();

  return json({ matchGuid: guid, scope: body.scope, reden: body.scope ? 'admin' : null });
}

/**
 * POST /api/admin/aanduiding   { matchGuid, email }
 *
 * Wijst een official toe. Controleert achtereenvolgens: staat de wedstrijd in
 * de lijst, is er nog een plaats vrij, mag deze persoon deze wedstrijd zien, en
 * botst het niet met iets waaraan hij al toegewezen is.
 *
 * Beschikbaarheid is géén voorwaarde. Een beheerder kan iemand toewijzen die
 * nog niet geantwoord heeft; dat gebeurt in de praktijk na een telefoontje.
 * Wie expliciet 'niet beschikbaar' antwoordde, wordt wel geweigerd tenzij
 * forceer meegegeven wordt.
 */
export async function wijsToe({ request, env, user }) {
  const body = await leesJson(request);
  const guid = typeof body.matchGuid === 'string' ? body.matchGuid.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const forceer = body.forceer === true;

  if (!guid || !email) return fout(400, 'Ongeldige aanvraag', 'matchGuid en email zijn nodig.');

  const wedstrijd = await env.DB.prepare(
    `SELECT m.guid, m.datum, m.uur, m.acc_guid, m.off_aantal, m.scope, m.cat_code, m.club_guid,
            m.thuis_naam, m.uit_naam, m.locatie,
            cat.groep AS cat_groep, cat.auto_scope
       FROM matches m
       LEFT JOIN categorieen cat ON cat.code = m.cat_code
      WHERE m.guid = ? AND m.status = 'actief'`,
  )
    .bind(guid)
    .first();

  if (!wedstrijd) return fout(404, 'Onbekende wedstrijd', 'Deze wedstrijd bestaat niet of is verdwenen.');
  if (!wedstrijd.scope) {
    return fout(409, 'Niet in de lijst', 'Zet deze wedstrijd eerst in de aanduidingslijst.');
  }

  const official = await env.DB.prepare(
    'SELECT email, voornaam, achternaam, profiel, club_guid, actief FROM users WHERE email = ?',
  )
    .bind(email)
    .first();
  if (!official) return fout(404, 'Onbekende gebruiker', `${email} staat niet in de lijst.`);
  if (!official.actief) return fout(409, 'Niet actief', 'Deze gebruiker staat op inactief.');
  if (official.club_guid && official.club_guid !== wedstrijd.club_guid) {
    return fout(409, 'Andere club', 'Deze official hoort bij een andere club.');
  }

  // Een YO ziet alleen U10/U12. Iemand toewijzen aan een wedstrijd die hij
  // daarna niet in zijn lijst terugvindt, is een garantie op verwarring.
  if (official.profiel === 'YO' && wedstrijd.cat_groep !== 'U10U12') {
    return fout(
      409,
      'Buiten profiel',
      `${official.voornaam} heeft profiel YO en ziet alleen U10/U12-wedstrijden.`,
    );
  }

  const bestaande = await env.DB.prepare(
    `SELECT status FROM assignments WHERE match_guid = ? AND user_email = ?`,
  )
    .bind(guid, email)
    .first();
  if (bestaande?.status === 'toegewezen') {
    return fout(409, 'Al toegewezen', 'Deze official staat al op deze wedstrijd.');
  }

  const bezet = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM assignments WHERE match_guid = ? AND status = 'toegewezen'`,
  )
    .bind(guid)
    .first();
  const nodig = aantalNodig(wedstrijd.off_aantal);
  if ((bezet?.n ?? 0) >= nodig) {
    return fout(
      409,
      'Volzet',
      nodig === 0
        ? 'Basketbal Vlaanderen heeft hier al twee scheidsrechters aangeduid.'
        : `Er ${nodig === 1 ? 'is' : 'zijn'} maar ${nodig} plaats${nodig === 1 ? '' : 'en'} en die ${nodig === 1 ? 'is' : 'zijn'} bezet.`,
    );
  }

  if (!forceer) {
    const antwoord = await env.DB.prepare(
      'SELECT status FROM availability WHERE match_guid = ? AND user_email = ?',
    )
      .bind(guid, email)
      .first();
    if (antwoord?.status === 'nee') {
      return fout(
        409,
        'Niet beschikbaar',
        `${official.voornaam} heeft zich niet beschikbaar gezet. Bevestig om toch toe te wijzen.`,
      );
    }
  }

  // Botsingen met wedstrijden waaraan deze official al toegewezen is.
  const { results: reeds } = await env.DB.prepare(
    `SELECT m.guid, m.datum, m.uur, m.acc_guid, m.thuis_naam, m.uit_naam, m.locatie
       FROM assignments a
       JOIN matches m ON m.guid = a.match_guid
      WHERE a.user_email = ? AND a.status = 'toegewezen' AND m.status = 'actief'
        AND m.datum BETWEEN date(?, '-1 day') AND date(?, '+1 day')`,
  )
    .bind(email, wedstrijd.datum, wedstrijd.datum)
    .all();

  const botsingen = conflicten(
    { guid, datum: wedstrijd.datum, uur: wedstrijd.uur, accGuid: wedstrijd.acc_guid },
    reeds.map((r) => ({
      guid: r.guid,
      datum: r.datum,
      uur: r.uur,
      accGuid: r.acc_guid,
      omschrijving: `${r.datum} ${r.uur} ${r.thuis_naam} - ${r.uit_naam}`,
      locatie: r.locatie,
    })),
  );

  if (botsingen.length > 0 && !forceer) {
    return fout(
      409,
      'Botst met een andere aanduiding',
      `${official.voornaam} staat al op ${botsingen.map((b) => b.omschrijving).join(' en ')}. ` +
        'Bevestig om toch toe te wijzen.',
    );
  }

  await env.DB.prepare(
    `INSERT INTO assignments (match_guid, user_email, status, toegewezen_door, toegewezen_op, gewijzigd_op)
     VALUES (?, ?, 'toegewezen', ?, datetime('now'), datetime('now'))
     ON CONFLICT (match_guid, user_email) DO UPDATE
       SET status = 'toegewezen', toegewezen_door = excluded.toegewezen_door,
           gewijzigd_op = datetime('now')`,
  )
    .bind(guid, email, user.email)
    .run();

  const naam = `${official.voornaam} ${official.achternaam}`;

  await log(env.DB, {
    categorie: 'aanduiding',
    soort: 'toegewezen',
    matchGuid: guid,
    wie: user.email,
    veld: wedstrijdOmschrijving(wedstrijd),
    nieuw: naam + (forceer && botsingen.length > 0 ? ' (geforceerd)' : ''),
  });

  // Mail versturen mag de aanduiding zelf niet laten mislukken. Een geweigerde
  // of onbereikbare maildienst is een probleem voor later, niet voor nu.
  const mail = templateAanduiding({
    naam,
    wedstrijd: `${wedstrijd.thuis_naam ?? ''} ${wedstrijd.uit_naam ? '- ' + wedstrijd.uit_naam : ''}`.trim()
      || `wedstrijd ${guid}`,
    datum: wedstrijd.datum,
    uur: wedstrijd.uur,
    locatie: wedstrijd.locatie,
    opkomst: opkomstUur(wedstrijd.uur) ?? wedstrijd.uur,
  });
  const verzending = await verwittig(env, email, mail).catch(() => ({ mail: false, push: 0 }));

  return json({
    matchGuid: guid,
    email,
    naam,
    geforceerd: forceer && botsingen.length > 0,
    botsingen: botsingen.map((b) => b.omschrijving),
    mailVerstuurd: verzending.mail,
    pushVerstuurd: verzending.push,
  });
}

/**
 * DELETE /api/admin/aanduiding?matchGuid=...&email=...
 *
 * Vrijgeven. Dekt zowel het intrekken van een eerdere aanduiding als het
 * weigeren van een voorstel: het verschil zit alleen in de begintoestand, en
 * die kent de databank zelf.
 */
export async function geefVrij({ url, env, user }) {
  const guid = (url.searchParams.get('matchGuid') ?? '').trim();
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
  if (!guid || !email) return fout(400, 'Ongeldige aanvraag', 'matchGuid en email zijn nodig.');

  const bestaande = await env.DB.prepare(
    'SELECT status FROM assignments WHERE match_guid = ? AND user_email = ?',
  )
    .bind(guid, email)
    .first();

  if (!bestaande) return fout(404, 'Geen aanduiding', 'Deze official staat niet op deze wedstrijd.');
  if (bestaande.status === 'vrijgegeven') {
    return json({ matchGuid: guid, email, alVrijgegeven: true });
  }

  await env.DB.prepare(
    `UPDATE assignments SET status = 'vrijgegeven', gewijzigd_op = datetime('now')
      WHERE match_guid = ? AND user_email = ?`,
  )
    .bind(guid, email)
    .run();

  const [wedstrijd, official] = await Promise.all([
    env.DB.prepare('SELECT thuis_naam, uit_naam, datum, uur FROM matches WHERE guid = ?').bind(guid).first(),
    env.DB.prepare('SELECT voornaam, achternaam FROM users WHERE email = ?').bind(email).first(),
  ]);

  await log(env.DB, {
    categorie: 'aanduiding',
    soort: 'vrijgegeven',
    matchGuid: guid,
    wie: user.email,
    veld: wedstrijdOmschrijving(wedstrijd),
    oud: official ? `${official.voornaam} ${official.achternaam}` : email,
  });

  let mailVerstuurd = false;
  if (wedstrijd && official) {
    const mail = templateVrijgegeven({
      naam: `${official.voornaam} ${official.achternaam}`,
      wedstrijd: `${wedstrijd.thuis_naam} - ${wedstrijd.uit_naam}`,
      datum: wedstrijd.datum,
      uur: wedstrijd.uur,
    });
    const verzending = await verwittig(env, email, mail).catch(() => ({ mail: false }));
    mailVerstuurd = verzending.mail;
  }

  return json({ matchGuid: guid, email, vrijgegeven: true, mailVerstuurd });
}

/** GET /api/admin/problemen — openstaande meldingen van officials. */
export async function problemen({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.match_guid, p.bericht, p.gemeld_op, p.afgehandeld,
            u.voornaam, u.achternaam, u.email,
            m.datum, m.uur, m.thuis_naam, m.uit_naam
       FROM problemen p
       JOIN users u ON u.email = p.user_email
       LEFT JOIN matches m ON m.guid = p.match_guid
      WHERE p.afgehandeld = 0
      ORDER BY p.id DESC LIMIT 50`,
  ).all();

  return json({
    problemen: results.map((r) => ({
      id: r.id,
      matchGuid: r.match_guid,
      naam: `${r.voornaam} ${r.achternaam}`,
      email: r.email,
      bericht: r.bericht,
      gemeldOp: r.gemeld_op,
      wedstrijd: r.datum ? `${r.datum} ${r.uur} ${r.thuis_naam} - ${r.uit_naam}` : null,
    })),
  });
}

/** PATCH /api/admin/problemen   { id, afgehandeld } */
export async function handelProbleemAf({ request, env, user }) {
  const body = await leesJson(request);
  const id = Number(body.id);
  if (!Number.isInteger(id)) return fout(400, 'Ongeldige aanvraag', 'id ontbreekt.');

  await env.DB.prepare('UPDATE problemen SET afgehandeld = ? WHERE id = ?')
    .bind(body.afgehandeld === false ? 0 : 1, id)
    .run();

  await log(env.DB, {
    categorie: 'aanduiding',
    soort: 'probleem',
    wie: user.email,
    veld: body.afgehandeld === false ? 'heropend' : 'afgehandeld',
    nieuw: `melding ${id}`,
  });

  return json({ id, afgehandeld: body.afgehandeld !== false });
}
