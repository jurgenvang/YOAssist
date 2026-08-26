import { json, fout, leesJson } from '../lib/http.js';
import { verwittig } from '../lib/verwittigen.js';

/**
 * Persoonlijke voorkeuren en push-abonnementen.
 *
 * Deze routes staan bewust NIET onder /api/admin/: ze gaan over de gebruiker
 * zelf, niet over de club. Een gewone Youth Official moet zijn eigen kanalen
 * kunnen instellen zonder ergens beheerder voor te zijn.
 *
 * Alles wordt hier op de aangemelde gebruiker toegepast. Er is geen manier om
 * de voorkeuren van iemand anders te wijzigen — ook niet voor een beheerder,
 * want dat is niet aan hem.
 */

/** GET /api/voorkeuren */
export async function voorkeuren({ env, user }) {
  const rij = await env.DB.prepare(
    `SELECT kanaal_mail, kanaal_push, herinner_avond, herinner_ochtend, verborgen_tabs
       FROM users WHERE email = ?`,
  )
    .bind(user.email)
    .first();

  const { results: toestellen } = await env.DB.prepare(
    `SELECT id, toestel, aangemaakt, laatst_ok
       FROM push_abonnementen WHERE user_email = ? ORDER BY id`,
  )
    .bind(user.email)
    .all();

  return json({
    mail: rij.kanaal_mail === 1,
    push: rij.kanaal_push === 1,
    herinnerAvond: rij.herinner_avond === 1,
    herinnerOchtend: rij.herinner_ochtend === 1,
    verborgenTabs: (rij.verborgen_tabs ?? '').split(',').filter(Boolean),
    toestellen: toestellen.map((t) => ({
      id: t.id,
      toestel: t.toestel,
      aangemaakt: t.aangemaakt,
      laatstOk: t.laatst_ok,
    })),
    // Zonder publieke sleutel kan de browser zich niet inschrijven; dan blijft
    // de pushknop uit in plaats van te falen bij het aanklikken.
    pushBeschikbaar: Boolean(env.VAPID_PUBLIEK),
    vapidPubliek: env.VAPID_PUBLIEK ?? null,
  });
}

/** PATCH /api/voorkeuren   { mail?, push?, herinnerAvond?, herinnerOchtend? } */
export async function zetVoorkeuren({ request, env, user }) {
  const body = await leesJson(request);

  const velden = [];
  const waarden = [];

  const zet = (sleutel, kolom) => {
    if (typeof body[sleutel] === 'boolean') {
      velden.push(`${kolom} = ?`);
      waarden.push(body[sleutel] ? 1 : 0);
    }
  };

  zet('mail', 'kanaal_mail');
  zet('push', 'kanaal_push');
  zet('herinnerAvond', 'herinner_avond');
  zet('herinnerOchtend', 'herinner_ochtend');

  // Welke tabbladen iemand wil zien. Puur een weergavevoorkeur: de backend
  // blijft weigeren wat iemand niet mag, ongeacht wat hier staat.
  if (Array.isArray(body.verborgenTabs)) {
    const toegestaan = ['club', 'log', 'geld'];
    const gekozen = body.verborgenTabs.filter((s) => toegestaan.includes(s));
    velden.push('verborgen_tabs = ?');
    waarden.push(gekozen.join(','));
  }

  if (velden.length === 0) {
    return fout(400, 'Niets te wijzigen', 'Geef minstens één voorkeur mee.');
  }

  waarden.push(user.email);
  await env.DB.prepare(`UPDATE users SET ${velden.join(', ')} WHERE email = ?`)
    .bind(...waarden)
    .run();

  // Wie push uitzet, hoeft zijn abonnementen niet te verliezen: hij kan het
  // morgen weer aanzetten zonder opnieuw toestemming te geven.
  return json({ gewijzigd: velden.length });
}

/**
 * POST /api/push/abonneer   { endpoint, p256dh, auth, toestel? }
 *
 * De browser levert deze gegevens nadat de gebruiker toestemming gaf. Eén rij
 * per toestel; dezelfde endpoint twee keer inschrijven vervangt de bestaande
 * rij in plaats van een dubbel aan te maken.
 */
export async function abonneer({ request, env, user }) {
  const body = await leesJson(request);

  const endpoint = String(body.endpoint ?? '').trim();
  const p256dh = String(body.p256dh ?? '').trim();
  const auth = String(body.auth ?? '').trim();

  if (!endpoint || !p256dh || !auth) {
    return fout(400, 'Ongeldige aanvraag', 'endpoint, p256dh en auth zijn alle drie nodig.');
  }

  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') {
      return fout(400, 'Ongeldig endpoint', 'Een push-endpoint moet https zijn.');
    }
  } catch {
    return fout(400, 'Ongeldig endpoint', 'Dit is geen geldige URL.');
  }

  await env.DB.prepare(
    `INSERT INTO push_abonnementen (user_email, endpoint, p256dh, auth, toestel)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_email = excluded.user_email, p256dh = excluded.p256dh,
           auth = excluded.auth, toestel = excluded.toestel, mislukt = 0`,
  )
    .bind(user.email, endpoint, p256dh, auth, String(body.toestel ?? '').slice(0, 100) || null)
    .run();

  // Inschrijven zonder push aan te zetten heeft geen zin; die twee horen samen.
  await env.DB.prepare('UPDATE users SET kanaal_push = 1 WHERE email = ?').bind(user.email).run();

  return json({ ok: true });
}

/** DELETE /api/push/abonneer?endpoint=... of ?id=... */
export async function afmelden({ url, env, user }) {
  const endpoint = url.searchParams.get('endpoint');
  const id = Number(url.searchParams.get('id'));

  if (!endpoint && !Number.isInteger(id)) {
    return fout(400, 'Ongeldige aanvraag', 'Geef endpoint of id mee.');
  }

  // Altijd op user_email meefilteren: niemand mag een toestel van een ander
  // afmelden, ook niet door met een id te gokken.
  const res = endpoint
    ? await env.DB
        .prepare('DELETE FROM push_abonnementen WHERE endpoint = ? AND user_email = ?')
        .bind(endpoint, user.email)
        .run()
    : await env.DB
        .prepare('DELETE FROM push_abonnementen WHERE id = ? AND user_email = ?')
        .bind(id, user.email)
        .run();

  return json({ verwijderd: res?.meta?.changes ?? 0 });
}

/**
 * POST /api/voorkeuren/test — stuurt een testbericht naar jezelf.
 *
 * Negeert de voorkeuren bewust: wie op de testknop drukt wil weten of het
 * kanaal werkt, niet of hij het aan heeft staan.
 */
export async function testBericht({ env, user }) {
  const uitslag = await verwittig(
    env,
    user.email,
    {
      onderwerp: 'YOAssist — testbericht',
      tekst: 'Als je dit ziet, werkt dit kanaal.',
      url: '/',
    },
    { negeerVoorkeur: true },
  );

  return json({
    mail: uitslag.mail,
    mailReden: uitslag.mailReden ?? null,
    push: uitslag.push,
    pushVerlopen: uitslag.pushVerlopen ?? 0,
  });
}
