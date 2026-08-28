import { json, fout, leesJson, instelling } from '../../lib/http.js';
import { leesCsv, maakCsv, alsBoolean } from '../../lib/csv.js';
import { templateWelkom } from '../../lib/mailer.js';
import { geldigNummer, whatsappLink, belLink, toonNummer } from '../../lib/telefoon.js';
import { oudersVan } from '../../lib/namens.js';
import { verwittig } from '../../lib/verwittigen.js';
import { log } from '../../lib/logboek.js';

/**
 * Gebruikersbeheer.
 *
 * Twee lijsten moeten synchroon blijven: deze tabel en de Access-policy in
 * Zero Trust. Wie hier staat maar niet daar, raakt nooit voorbij het
 * loginscherm; wie daar staat maar niet hier, krijgt "Niet in de ledenlijst".
 * Daarom levert de lijst ook een kopieerklare adressenreeks op.
 *
 * Twee sloten tegen buitensluiting: een beheerder kan zijn eigen adminvlag niet
 * afzetten en zichzelf niet deactiveren. Zonder die sloten is één verkeerde
 * klik genoeg om niemand meer bij het beheer te laten.
 */

const PROFIELEN = ['YO', 'YO+'];

function normaliseerEmail(waarde) {
  return typeof waarde === 'string' ? waarde.trim().toLowerCase() : '';
}

function geldigEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** GET /api/admin/users */
export async function lijst({ env }) {
  const { results: koppelingen } = await env.DB
    .prepare('SELECT ouder_email, kind_email FROM ouder_kind')
    .all()
    .catch(() => ({ results: [] }));

  const kinderenPer = new Map();
  const oudersPer = new Map();
  for (const k of koppelingen) {
    kinderenPer.set(k.ouder_email, [...(kinderenPer.get(k.ouder_email) ?? []), k.kind_email]);
    oudersPer.set(k.kind_email, [...(oudersPer.get(k.kind_email) ?? []), k.ouder_email]);
  }

  const { results } = await env.DB.prepare(
    `SELECT u.email, u.voornaam, u.achternaam, u.is_admin, u.profiel, u.club_guid,
            u.gsm, u.actief, c.naam AS club_naam,
            (SELECT COUNT(*) FROM availability a WHERE a.user_email = u.email) AS aantal_antwoorden
       FROM users u
       LEFT JOIN clubs c ON c.guid = u.club_guid
      ORDER BY u.actief DESC, u.achternaam COLLATE NOCASE, u.voornaam COLLATE NOCASE`,
  ).all();

  const gebruikers = results.map((r) => ({
    email: r.email,
    voornaam: r.voornaam,
    achternaam: r.achternaam,
    naam: `${r.voornaam} ${r.achternaam}`,
    isAdmin: r.is_admin === 1,
    profiel: r.profiel,
    clubGuid: r.club_guid,
    clubNaam: r.club_naam,
    gsm: r.gsm,
    gsmLeesbaar: toonNummer(r.gsm),
    kinderen: kinderenPer.get(r.email) ?? [],
    ouders: oudersPer.get(r.email) ?? [],
    whatsapp: whatsappLink(r.gsm),
    bellen: belLink(r.gsm),
    actief: r.actief === 1,
    aantalAntwoorden: r.aantal_antwoorden,
  }));

  return json({
    gebruikers,
    // Precies de adressen die in de Access-policy horen: actieve gebruikers.
    // Inactieve laten staan zou seats blijven opeten.
    accessLijst: gebruikers.filter((g) => g.actief).map((g) => g.email).join('\n'),
    aantalActief: gebruikers.filter((g) => g.actief).length,
  });
}

/** POST /api/admin/users */
export async function toevoegen({ request, env, user }) {
  const body = await leesJson(request);
  const email = normaliseerEmail(body.email);

  if (!geldigEmail(email)) {
    return fout(400, 'Ongeldig e-mailadres', 'Controleer het adres.');
  }

  const voornaam = String(body.voornaam ?? '').trim();
  const achternaam = String(body.achternaam ?? '').trim();
  if (!voornaam || !achternaam) {
    return fout(400, 'Naam ontbreekt', 'Voornaam en achternaam zijn allebei nodig.');
  }

  const profiel = PROFIELEN.includes(body.profiel) ? body.profiel : 'YO';

  let clubGuid = null;
  if (body.clubGuid) {
    const club = await env.DB.prepare('SELECT guid FROM clubs WHERE guid = ? AND actief = 1')
      .bind(String(body.clubGuid).toUpperCase())
      .first();
    if (!club) return fout(404, 'Onbekende club', 'Die club is niet geconfigureerd of inactief.');
    clubGuid = club.guid;
  }

  const bestaat = await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (bestaat) return fout(409, 'Bestaat al', `${email} staat al in de lijst.`);

  const gsm = String(body.gsm ?? '').trim() || null;
  if (!geldigNummer(gsm)) {
    return fout(400, 'Ongeldig nummer',
      'Dat lijkt geen telefoonnummer. Laat het leeg als je het niet hebt.');
  }

  await env.DB.prepare(
    `INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid, gsm, actief)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  )
    .bind(email, voornaam, achternaam, body.isAdmin ? 1 : 0, profiel, clubGuid, gsm)
    .run();

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'gebruiker',
    wie: user.email,
    veld: 'gebruiker toegevoegd',
    nieuw: `${email} (${voornaam} ${achternaam}, ${profiel})`,
  });

  return json({
    email,
    herinnering: 'Vergeet dit adres niet toe te voegen aan de Access-policy in Zero Trust.',
  });
}

/** PATCH /api/admin/users */
export async function wijzigen({ request, env, user }) {
  const body = await leesJson(request);
  const email = normaliseerEmail(body.email);

  const bestaand = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!bestaand) return fout(404, 'Onbekende gebruiker', `${email} staat niet in de lijst.`);

  const eigenAccount = email === user.email;

  if (eigenAccount && body.isAdmin === false) {
    return fout(
      409,
      'Kan jezelf niet degraderen',
      'Laat een andere beheerder dit doen, anders raakt niemand nog bij het beheer.',
    );
  }
  if (eigenAccount && body.actief === false) {
    return fout(409, 'Kan jezelf niet deactiveren', 'Laat een andere beheerder dit doen.');
  }

  const velden = [];
  const waarden = [];

  if (typeof body.voornaam === 'string' && body.voornaam.trim()) {
    velden.push('voornaam = ?');
    waarden.push(body.voornaam.trim());
  }
  if (typeof body.achternaam === 'string' && body.achternaam.trim()) {
    velden.push('achternaam = ?');
    waarden.push(body.achternaam.trim());
  }
  if (PROFIELEN.includes(body.profiel)) {
    velden.push('profiel = ?');
    waarden.push(body.profiel);
  }
  if (typeof body.isAdmin === 'boolean') {
    velden.push('is_admin = ?');
    waarden.push(body.isAdmin ? 1 : 0);
  }
  if (typeof body.actief === 'boolean') {
    velden.push('actief = ?');
    waarden.push(body.actief ? 1 : 0);
  }
  if (typeof body.gsm === 'string') {
    if (!geldigNummer(body.gsm)) {
      return fout(400, 'Ongeldig nummer', 'Dat lijkt geen telefoonnummer.');
    }
    velden.push('gsm = ?');
    waarden.push(body.gsm.trim() || null);
  }
  if (body.clubGuid !== undefined) {
    if (body.clubGuid === null) {
      velden.push('club_guid = NULL');
    } else {
      const club = await env.DB.prepare('SELECT guid FROM clubs WHERE guid = ? AND actief = 1')
        .bind(String(body.clubGuid).toUpperCase())
        .first();
      if (!club) return fout(404, 'Onbekende club', 'Die club is niet geconfigureerd of inactief.');
      velden.push('club_guid = ?');
      waarden.push(club.guid);
    }
  }

  if (velden.length === 0) return fout(400, 'Niets te wijzigen', 'Geef minstens één veld mee.');

  // Laatste slot: er moet altijd minstens één actieve beheerder overblijven.
  if (body.isAdmin === false || body.actief === false) {
    const overig = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND actief = 1 AND email != ?',
    )
      .bind(email)
      .first();
    if ((overig?.n ?? 0) === 0) {
      return fout(
        409,
        'Laatste beheerder',
        'Dit is de enige actieve beheerder. Maak eerst iemand anders beheerder.',
      );
    }
  }

  waarden.push(email);
  await env.DB.prepare(`UPDATE users SET ${velden.join(', ')} WHERE email = ?`)
    .bind(...waarden)
    .run();

  // Vooral de gevoelige velden zijn de moeite van het loggen waard: wie
  // beheerder werd of niet meer, wie op inactief ging. De rest komt er kort
  // bij zodat het overzicht compleet blijft.
  const wijzigingen = [];
  if (typeof body.isAdmin === 'boolean') {
    wijzigingen.push(body.isAdmin ? 'beheerder gemaakt' : 'beheerder afgehaald');
  }
  if (typeof body.actief === 'boolean') {
    wijzigingen.push(body.actief ? 'geactiveerd' : 'op inactief gezet');
  }
  if (PROFIELEN.includes(body.profiel)) wijzigingen.push(`profiel naar ${body.profiel}`);
  if (body.clubGuid !== undefined) wijzigingen.push('club gewijzigd');
  if (typeof body.gsm === 'string') wijzigingen.push('gsm-nummer gewijzigd');
  if (typeof body.voornaam === 'string' || typeof body.achternaam === 'string') {
    wijzigingen.push('naam gewijzigd');
  }

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'gebruiker',
    wie: user.email,
    veld: `${email}: ${wijzigingen.join(', ') || 'gewijzigd'}`,
  });

  return json({ email, gewijzigd: velden.length });
}

/**
 * DELETE /api/admin/users?email=...
 *
 * Alleen wie nog nooit iets heeft ingevuld, wordt echt verwijderd. Voor de rest
 * is deactiveren de juiste actie: zijn antwoorden en later zijn toewijzingen
 * horen bij de historiek van het seizoen.
 */
export async function verwijderen({ url, env, user }) {
  const email = normaliseerEmail(url.searchParams.get('email'));

  if (email === user.email) {
    return fout(409, 'Kan jezelf niet verwijderen', 'Laat een andere beheerder dit doen.');
  }

  const bestaand = await env.DB.prepare('SELECT email FROM users WHERE email = ?').bind(email).first();
  if (!bestaand) return fout(404, 'Onbekende gebruiker', `${email} staat niet in de lijst.`);

  const gebruikt = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM availability WHERE user_email = ?',
  )
    .bind(email)
    .first();

  if ((gebruikt?.n ?? 0) > 0) {
    return fout(
      409,
      'Heeft al antwoorden',
      `${email} heeft ${gebruikt.n} beschikbaarheden ingevuld. Zet de gebruiker op inactief in plaats van te verwijderen.`,
    );
  }

  await env.DB.prepare('DELETE FROM users WHERE email = ?').bind(email).run();

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'gebruiker',
    wie: user.email,
    veld: 'gebruiker verwijderd',
    oud: email,
  });

  return json({
    email,
    verwijderd: true,
    herinnering: 'Haal dit adres ook uit de Access-policy, anders blijft het een seat innemen.',
  });
}


// ---------------------------------------------------------------------------
// Bulk toevoegen via CSV
// ---------------------------------------------------------------------------

const CSV_KOLOMMEN = ['email', 'voornaam', 'achternaam', 'profiel', 'club_guid', 'is_admin'];

/**
 * GET /api/admin/users/template — een leeg sjabloon met één voorbeeldregel.
 *
 * De voorbeeldregel is er om de vorm te tonen, niet om ingelezen te worden.
 * Hij wordt bij de import overgeslagen omdat het adres op example.be eindigt.
 */
export function template() {
  const csv = maakCsv(CSV_KOLOMMEN, [
    {
      email: 'jan.peeters@example.be',
      voornaam: 'Jan',
      achternaam: 'Peeters',
      profiel: 'YO',
      club_guid: '',
      is_admin: '0',
    },
  ]);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="yoassist-gebruikers.csv"',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * POST /api/admin/users/import   { csv: string, uitvoeren?: boolean }
 *
 * Standaard een droogloop, net als bij de automatische toewijzing: eerst tonen
 * wat er zou gebeuren, pas na bevestiging wegschrijven. Bij een bestand met
 * dertig namen wil je de fouten zien vóór de helft er half in staat.
 *
 * Rijen worden per stuk beoordeeld. Eén foute regel blokkeert de rest niet;
 * die komt in de foutenlijst met het regelnummer erbij.
 */
export async function importeer({ request, env }) {
  const body = await leesJson(request);
  const uitvoeren = body.uitvoeren === true;

  const { kolommen, rijen } = leesCsv(body.csv);

  if (rijen.length === 0) {
    return fout(400, 'Leeg bestand', 'Er staan geen gegevensregels in dit bestand.');
  }

  const ontbrekend = ['email', 'voornaam', 'achternaam'].filter((k) => !kolommen.includes(k));
  if (ontbrekend.length > 0) {
    return fout(
      400,
      'Kolommen ontbreken',
      `Deze kolom${ontbrekend.length > 1 ? 'men ontbreken' : ' ontbreekt'}: ${ontbrekend.join(', ')}. ` +
        `Verwacht: ${CSV_KOLOMMEN.join(', ')}.`,
    );
  }

  const bestaand = new Set(
    (await env.DB.prepare('SELECT email FROM users').all()).results.map((r) => r.email),
  );
  const clubs = new Set(
    (await env.DB.prepare('SELECT guid FROM clubs WHERE actief = 1').all()).results.map((r) => r.guid),
  );

  const nieuw = [];
  const overgeslagen = [];
  const fouten = [];
  const gezienInBestand = new Set();

  for (const rij of rijen) {
    const regel = rij._regel;
    const email = normaliseerEmail(rij.email);

    // De voorbeeldregel uit het sjabloon stilzwijgend negeren.
    if (email.endsWith('@example.be') || email.endsWith('@example.com')) continue;

    if (!geldigEmail(email)) {
      fouten.push({ regel, email: rij.email, reden: 'ongeldig e-mailadres' });
      continue;
    }
    if (gezienInBestand.has(email)) {
      fouten.push({ regel, email, reden: 'komt twee keer voor in dit bestand' });
      continue;
    }
    gezienInBestand.add(email);

    if (bestaand.has(email)) {
      overgeslagen.push({ regel, email, reden: 'staat al in de lijst' });
      continue;
    }

    const voornaam = String(rij.voornaam ?? '').trim();
    const achternaam = String(rij.achternaam ?? '').trim();
    if (!voornaam || !achternaam) {
      fouten.push({ regel, email, reden: 'voornaam of achternaam ontbreekt' });
      continue;
    }

    const ruwProfiel = String(rij.profiel ?? '').trim().toUpperCase();
    const profiel = PROFIELEN.includes(ruwProfiel) ? ruwProfiel : 'YO';

    let clubGuid = null;
    const ruweClub = String(rij.club_guid ?? '').trim().toUpperCase();
    if (ruweClub) {
      if (!clubs.has(ruweClub)) {
        fouten.push({ regel, email, reden: `club ${ruweClub} bestaat niet of is inactief` });
        continue;
      }
      clubGuid = ruweClub;
    }

    nieuw.push({
      regel,
      email,
      voornaam,
      achternaam,
      naam: `${voornaam} ${achternaam}`,
      profiel,
      clubGuid,
      isAdmin: alsBoolean(rij.is_admin),
    });
  }

  if (uitvoeren && nieuw.length > 0) {
    await env.DB.batch(
      nieuw.map((g) =>
        env.DB
          .prepare(
            `INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid, actief)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
          )
          .bind(g.email, g.voornaam, g.achternaam, g.isAdmin ? 1 : 0, g.profiel, g.clubGuid),
      ),
    );
  }

  return json({
    uitgevoerd: uitvoeren,
    aantalNieuw: nieuw.length,
    aantalOvergeslagen: overgeslagen.length,
    aantalFouten: fouten.length,
    nieuw,
    overgeslagen,
    fouten,
    herinnering:
      nieuw.length > 0
        ? 'Vergeet deze adressen niet toe te voegen aan de Access-policy in Zero Trust.'
        : null,
  });
}


/**
 * POST /api/admin/users/welkom   { email?, uitvoeren?, adres? }
 *
 * Zonder email: naar alle actieve gebruikers. Met email: naar die ene.
 * Standaard een droogloop, zoals overal waar iets de deur uit gaat — een
 * welkomstmail naar dertig mensen wil je niet per ongeluk twee keer sturen.
 */
export async function welkom({ request, env, user }) {
  const body = await leesJson(request);
  const uitvoeren = body.uitvoeren === true;
  const adres = String(body.adres ?? 'https://yoassist.org').trim();

  const enkel = body.email ? normaliseerEmail(body.email) : null;

  const methodes = (await instelling(env.DB, 'aanmeld_methodes', 'pin'))
    .split(',').map((s) => s.trim()).filter(Boolean);

  const { results } = await env.DB.prepare(
    `SELECT u.email, u.voornaam, u.achternaam, u.is_admin, c.naam AS club_naam
       FROM users u
       LEFT JOIN clubs c ON c.guid = u.club_guid
      WHERE u.actief = 1 ${enkel ? 'AND u.email = ?' : ''}
      ORDER BY u.achternaam COLLATE NOCASE, u.voornaam COLLATE NOCASE`,
  )
    .bind(...(enkel ? [enkel] : []))
    .all();

  if (results.length === 0) {
    return fout(404, 'Niemand gevonden', enkel
      ? 'Dit adres staat niet in de lijst, of is op inactief gezet.'
      : 'Er zijn geen actieve gebruikers.');
  }

  const ontvangers = results.map((r) => ({
    email: r.email,
    naam: `${r.voornaam} ${r.achternaam}`,
    isAdmin: r.is_admin === 1,
    clubNaam: r.club_naam,
  }));

  if (!uitvoeren) {
    // De voorbeeldtekst meesturen: dan ziet een beheerder wat er verstuurd wordt
    // in plaats van te moeten vertrouwen dat het klopt.
    const voorbeeld = templateWelkom({ ...ontvangers[0], adres, methodes });
    return json({
      uitgevoerd: false,
      aantal: ontvangers.length,
      ontvangers,
      methodes,
      voorbeeld: voorbeeld.tekst,
    });
  }

  let verstuurd = 0;
  for (const o of ontvangers) {
    const bericht = templateWelkom({ ...o, adres, methodes });
    const res = await verwittig(env, o.email, bericht).catch(() => ({ mail: false }));
    if (res.mail) verstuurd++;
  }

  // De ontvangers zelf in het log, niet enkel een aantal — anders is achteraf
  // niet meer te zien wíe die welkomstmail kreeg, en lijkt de log-regel enkel
  // over de beheerder te gaan die op de knop klikte.
  const adressen = ontvangers.map((o) => o.email);
  const genoemd = adressen.length <= 8
    ? adressen.join(', ')
    : `${adressen.slice(0, 8).join(', ')}, en nog ${adressen.length - 8}`;

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'welkom',
    wie: user.email,
    veld: `welkomstmail verstuurd (${verstuurd} van ${ontvangers.length})`,
    nieuw: genoemd,
  });

  return json({ uitgevoerd: true, aantal: ontvangers.length, verstuurd });
}


/**
 * POST /api/admin/users/ouder   { ouder, kind }
 *
 * Koppelt een kind aan een ouder. Alleen een beheerder doet dit: zou een ouder
 * het zelf kunnen aanvragen, dan kan iemand een willekeurig kind aan zichzelf
 * hangen.
 */
export async function koppelOuder({ request, env, user }) {
  const body = await leesJson(request);
  const ouder = normaliseerEmail(body.ouder);
  const kind = normaliseerEmail(body.kind);

  if (!ouder || !kind) return fout(400, 'Ongeldige aanvraag', 'ouder en kind zijn beide nodig.');
  if (ouder === kind) {
    return fout(400, 'Zelfde persoon', 'Iemand kan geen ouder van zichzelf zijn.');
  }

  const beide = await env.DB.prepare(
    'SELECT email FROM users WHERE email IN (?, ?)',
  ).bind(ouder, kind).all();

  if (beide.results.length !== 2) {
    return fout(404, 'Onbekend adres', 'Ouder of kind staat niet in de gebruikerslijst.');
  }

  // Geen ketens: is het kind zelf al ouder van iemand, dan wordt het onduidelijk
  // wie namens wie handelt. Eén niveau volstaat voor waar dit voor dient.
  const isZelfOuder = await env.DB
    .prepare('SELECT 1 AS x FROM ouder_kind WHERE ouder_email = ?').bind(kind).first();
  if (isZelfOuder) {
    return fout(409, 'Al ouder', `${kind} is zelf al aan een kind gekoppeld.`);
  }

  await env.DB.prepare(
    `INSERT INTO ouder_kind (ouder_email, kind_email, door) VALUES (?, ?, ?)
     ON CONFLICT (ouder_email, kind_email) DO NOTHING`,
  ).bind(ouder, kind, user.email).run();

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'gebruiker',
    wie: user.email,
    veld: 'ouder gekoppeld',
    nieuw: `${ouder} mag invullen namens ${kind}`,
  });

  return json({ ouder, kind, gekoppeld: true });
}

/** DELETE /api/admin/users/ouder?ouder=…&kind=… */
export async function ontkoppelOuder({ url, env, user }) {
  const ouder = normaliseerEmail(url.searchParams.get('ouder'));
  const kind = normaliseerEmail(url.searchParams.get('kind'));

  if (!ouder || !kind) return fout(400, 'Ongeldige aanvraag', 'ouder en kind zijn beide nodig.');

  const res = await env.DB
    .prepare('DELETE FROM ouder_kind WHERE ouder_email = ? AND kind_email = ?')
    .bind(ouder, kind)
    .run();

  await log(env.DB, {
    categorie: 'beheer',
    soort: 'gebruiker',
    wie: user.email,
    veld: 'ouderkoppeling verwijderd',
    oud: `${ouder} — ${kind}`,
  });

  return json({ verwijderd: res?.meta?.changes ?? 0 });
}
