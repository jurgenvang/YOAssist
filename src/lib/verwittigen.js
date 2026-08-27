/**
 * Berichten versturen naar één persoon, over de kanalen die hij zelf gekozen
 * heeft.
 *
 * Elke plek in de code die iemand wil verwittigen gaat hierlangs, niet
 * rechtstreeks naar `verstuur()` of `stuurPush()`. Zo staan de voorkeuren op
 * één plaats afgedwongen en kan een nieuwe aanroeper ze niet vergeten.
 *
 * Mail blijft het betrouwbare kanaal. Push is een extraatje: op iPhone werkt
 * het alleen als de gebruiker de site aan zijn beginscherm heeft toegevoegd, en
 * abonnementen verlopen stil. Wie push aanzet en mail uitzet, kan dus berichten
 * missen — daarom staat mail standaard aan.
 */

import { verstuur } from './mailer.js';
import { stuurPush } from './push.js';

/**
 * @param {D1Database} db
 * @param {object} env
 * @param {string} email
 * @param {object} bericht {onderwerp, tekst, url?}
 * @param {object} [opties] {negeerVoorkeur} — voor berichten die altijd moeten
 *   aankomen, zoals een testbericht dat de gebruiker zelf uitlokt
 */
export async function verwittig(env, email, bericht, opties = {}) {
  const gebruiker = await env.DB.prepare(
    'SELECT kanaal_mail, kanaal_push, actief FROM users WHERE email = ?',
  )
    .bind(email)
    .first();

  if (!gebruiker) return { mail: false, push: 0, reden: 'onbekende gebruiker' };
  if (!gebruiker.actief && !opties.negeerVoorkeur) {
    return { mail: false, push: 0, reden: 'niet actief' };
  }

  const wilMail = opties.negeerVoorkeur || gebruiker.kanaal_mail === 1;
  const wilPush = opties.negeerVoorkeur || gebruiker.kanaal_push === 1;

  const uitslag = { mail: false, push: 0, pushVerlopen: 0 };

  if (wilMail) {
    const res = await verstuur(env, {
      naar: email,
      onderwerp: bericht.onderwerp,
      tekst: bericht.tekst + (await meldingenVoettekst(env, email, gebruiker)),
    }).catch(() => ({ verstuurd: false }));
    uitslag.mail = res.verstuurd;
    if (!res.verstuurd) uitslag.mailReden = res.reden;
  }

  if (wilPush) {
    const { results: abonnementen } = await env.DB.prepare(
      'SELECT id, endpoint, p256dh, auth FROM push_abonnementen WHERE user_email = ?',
    )
      .bind(email)
      .all();

    const sleutels = {
      publiek: env.VAPID_PUBLIEK,
      prive: env.VAPID_PRIVE,
      onderwerp: `mailto:${env.VAPID_CONTACT ?? 'yoassist@example.be'}`,
    };

    for (const abo of abonnementen) {
      const res = await stuurPush(
        abo,
        {
          titel: bericht.onderwerp,
          tekst: bericht.tekst.split('\n').filter(Boolean).slice(0, 3).join(' '),
          url: bericht.url ?? '/',
        },
        sleutels,
      );

      if (res.verstuurd) {
        uitslag.push++;
        await env.DB
          .prepare("UPDATE push_abonnementen SET laatst_ok = datetime('now'), mislukt = 0 WHERE id = ?")
          .bind(abo.id)
          .run()
          .catch(() => {});
      } else if (res.verlopen) {
        // Een verlopen abonnement blijven proberen levert alleen ruis op.
        uitslag.pushVerlopen++;
        await env.DB.prepare('DELETE FROM push_abonnementen WHERE id = ?')
          .bind(abo.id)
          .run()
          .catch(() => {});
      } else {
        await env.DB
          .prepare('UPDATE push_abonnementen SET mislukt = mislukt + 1 WHERE id = ?')
          .bind(abo.id)
          .run()
          .catch(() => {});
      }
    }
  }

  return uitslag;
}

/** Verwittigt meerdere mensen. Faalt per persoon, niet in het geheel. */
export async function verwittigAllen(env, emails, bericht) {
  const resultaten = await Promise.all(
    emails.map((e) =>
      verwittig(env, e, bericht).catch(() => ({ mail: false, push: 0 })),
    ),
  );

  return {
    mails: resultaten.filter((r) => r.mail).length,
    pushberichten: resultaten.reduce((n, r) => n + r.push, 0),
  };
}


/**
 * Verstuurt naar een adres dat geen YOAssist-gebruiker is — de penningmeester
 * die de verzamelstaat krijgt, bijvoorbeeld.
 *
 * Zulke ontvangers hebben geen voorkeuren en geen push-abonnement, dus er valt
 * niets toe te passen. Toch gaat het langs hier en niet rechtstreeks naar
 * `verstuur()`: dan blijft er één plaats waar berichten het huis verlaten.
 */
export async function verwittigExtern(env, emails, bericht) {
  const resultaten = await Promise.all(
    emails.map((naar) =>
      verstuur(env, { naar, onderwerp: bericht.onderwerp, tekst: bericht.tekst })
        .catch(() => ({ verstuurd: false })),
    ),
  );

  return { mails: resultaten.filter((r) => r.verstuurd).length };
}


/**
 * Voettekst die uitlegt hoe je meldingen aanzet.
 *
 * Alleen voor wie ze nog niet heeft. In elke mail zetten zou betekenen dat
 * mensen die ze al maanden gebruiken telkens dezelfde uitleg meekrijgen, en dan
 * leest niemand de voettekst nog.
 *
 * De iPhone-stap staat er expliciet bij omdat het de meest voorkomende reden is
 * dat meldingen niet werken: op iOS kan een website pas meldingen sturen nadat
 * ze aan het beginscherm is toegevoegd. Dat is een beperking van Apple die niet
 * te omzeilen is, en zonder uitleg lijkt het gewoon kapot.
 */
async function meldingenVoettekst(env, email, gebruiker) {
  if (gebruiker.kanaal_push === 1) return '';

  // Heeft iemand al een toestel geregistreerd maar het kanaal uitgezet, dan
  // weet hij hoe het werkt en is de uitleg overbodig.
  const toestellen = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM push_abonnementen WHERE user_email = ?')
    .bind(email)
    .first()
    .catch(() => null);

  if ((toestellen?.n ?? 0) > 0) return '';

  return (
    '\n\n' +
    '—\n' +
    'Liever een melding op je gsm in plaats van een mail?\n' +
    'Open YOAssist, tik op je naam rechtsboven en kies Mijn voorkeuren. ' +
    'Zet daar Meldingen aan.\n\n' +
    'Op een iPhone werkt dat alleen als je de app eerst aan je beginscherm zet: ' +
    'open YOAssist in Safari, tik op het deelicoon onderaan (het vierkantje met ' +
    'de pijl omhoog), kies "Zet op beginscherm", en open de app daarna via dat ' +
    'icoon. Pas dan kun je meldingen aanzetten. Dat is een regel van Apple, niet ' +
    'van YOAssist.'
  );
}
