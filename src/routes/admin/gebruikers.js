import { json, fout, leesJson } from '../../lib/http.js';
import { leesCsv, maakCsv, alsBoolean } from '../../lib/csv.js';

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
export async function toevoegen({ request, env }) {
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

  await env.DB.prepare(
    `INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid, gsm, actief)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  )
    .bind(
      email,
      voornaam,
      achternaam,
      body.isAdmin ? 1 : 0,
      profiel,
      clubGuid,
      String(body.gsm ?? '').trim() || null,
    )
    .run();

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
