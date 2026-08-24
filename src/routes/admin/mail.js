import { json, fout, leesJson, instelling } from '../../lib/http.js';
import { zetInstelling } from '../../lib/sync.js';
import { isZandbak, ZANDBAK_AFZENDER } from '../../lib/mailer.js';

/**
 * Mailconfiguratie.
 *
 * Het afzenderadres en de weergavenaam staan in de databank, wijzigbaar door
 * een beheerder. De API-sleutel van de maildienst staat NIET hier — die is een
 * secret bij de Worker (RESEND_API_KEY), buiten bereik van dit scherm en van
 * git. Dit scherm toont enkel of die secret aanwezig is, nooit de waarde.
 *
 * Zolang mail_afzender leeg is, blijft de communicatiemodule uit: er wordt dan
 * bewust niets verstuurd, ook al staat er een geldige secret.
 */


const EMAIL_PATROON = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** GET /api/admin/mail */
export async function config({ env }) {
  const afzender = await instelling(env.DB, 'mail_afzender', '');
  const afzenderNaam = await instelling(env.DB, 'mail_afzender_naam', 'YOAssist');

  const zandbak = isZandbak(afzender);

  return json({
    afzender,
    afzenderNaam,
    // Enkel of de secret bestaat, nooit de waarde zelf.
    apiSleutelAanwezig: Boolean(env.RESEND_API_KEY),
    actief: Boolean(afzender) && Boolean(env.RESEND_API_KEY),
    zandbak,
    zandbakAdres: ZANDBAK_AFZENDER,
    // In zandbakmodus wordt er niet naar anderen verstuurd. Dat is geen
    // beperking die wij opleggen om lastig te doen: Resend weigert het, en een
    // rij mislukte verzendingen is erger dan er geen te proberen.
    magNaarAnderen: Boolean(afzender) && !zandbak,
  });
}

/** POST /api/admin/mail   { afzender, afzenderNaam } */
export async function zetConfig({ request, env }) {
  const body = await leesJson(request);
  const afzender = String(body.afzender ?? '').trim().toLowerCase();
  const afzenderNaam = String(body.afzenderNaam ?? '').trim();

  if (afzender && !EMAIL_PATROON.test(afzender)) {
    return fout(400, 'Ongeldig adres', 'Controleer het afzenderadres.');
  }
  if (!afzenderNaam) {
    return fout(400, 'Naam ontbreekt', 'Geef een weergavenaam voor de afzender.');
  }

  await zetInstelling(env.DB, 'mail_afzender', afzender);
  await zetInstelling(env.DB, 'mail_afzender_naam', afzenderNaam);

  return json({
    afzender,
    afzenderNaam,
    zandbak: isZandbak(afzender),
    herinnering: !afzender
      ? null
      : isZandbak(afzender)
        ? 'Testmodus: Resend levert alleen af bij het adres waarmee je je hebt geregistreerd. Andere ontvangers worden geweigerd.'
        : `Zorg dat ${afzender.split('@')[1]} geverifieerd is bij de maildienst (SPF, DKIM, DMARC), anders wordt mail geweigerd of als spam gezien.`,
  });
}

/**
 * POST /api/admin/mail/test — stuurt een testmail naar de beheerder zelf.
 *
 * De enige manier om zonder gedoe te weten of domein, secret en Resend
 * allemaal kloppen, is het gewoon proberen. Faalt het, dan komt de foutmelding
 * van Resend rechtstreeks terug — die zegt meestal precies wat er mis is
 * (domein niet geverifieerd, ongeldige sleutel, enzovoort).
 */
export async function testMail({ env, user }) {
  const afzender = await instelling(env.DB, 'mail_afzender', '');
  const afzenderNaam = await instelling(env.DB, 'mail_afzender_naam', 'YOAssist');

  if (!afzender) return fout(400, 'Geen afzender ingesteld', 'Vul eerst een afzenderadres in.');
  if (!env.RESEND_API_KEY) {
    return fout(400, 'Geen API-sleutel', 'RESEND_API_KEY ontbreekt als secret bij de Worker.');
  }

  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${afzenderNaam} <${afzender}>`,
        to: user.email,
        subject: 'YOAssist — testmail',
        html:
          `<p>Deze mail bevestigt dat ${afzender} correct is ingesteld en dat de verbinding met Resend werkt.</p>` +
          (isZandbak(afzender)
            ? '<p>Je zit in testmodus. Verstuur je later naar anderen dan jezelf, dan moet er eerst een eigen domein geverifieerd worden.</p>'
            : ''),
      }),
    });
  } catch (err) {
    return fout(502, 'Resend niet bereikbaar', err.message);
  }

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const uitleg = isZandbak(afzender)
      ? `In testmodus levert Resend alleen af bij het adres waarmee je je hebt geregistreerd. Is dat ${user.email}?`
      : `Controleer of ${afzender.split('@')[1]} geverifieerd is bij Resend.`;
    return fout(502, 'Resend weigerde de mail', body?.message || `Status ${res.status}. ${uitleg}`);
  }

  return json({ ok: true, naar: user.email, zandbak: isZandbak(afzender) });
}