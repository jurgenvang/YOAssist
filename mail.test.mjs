/**
 * Eenmalig uit te voeren: maakt een VAPID-sleutelpaar aan.
 *
 *   cd test && node maak-vapid.mjs
 *
 * De publieke sleutel mag gezien worden — die gaat naar elke browser. De
 * private hoort als secret bij de Worker en nergens anders, zeker niet in git.
 */
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { maakVapidSleutels } = await import('../src/lib/push.js');
const sleutels = await maakVapidSleutels();

console.log(`
Zet deze drie als secret bij de Worker:
  Settings > Variables and Secrets > Add secret

  VAPID_PUBLIEK   ${sleutels.publiek}

  VAPID_PRIVE     ${sleutels.prive}

  VAPID_CONTACT   jouw@e-mailadres.be

De publieke sleutel is niet geheim; de private wel. Bewaar die nergens anders.
Raak je hem kwijt, dan moet iedereen zich opnieuw inschrijven voor meldingen.
`);
