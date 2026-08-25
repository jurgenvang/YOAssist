/**
 * Web Push versturen vanuit een Worker.
 *
 * Er bestaat geen bibliotheek voor die in Workers draait — `web-push` uit Node
 * leunt op Node-crypto. Dus doen we het met WebCrypto. Twee stukken:
 *
 *  1. Een VAPID-JWT dat bewijst dat wij de afzender zijn. ECDSA P-256,
 *     ondertekend met de private sleutel die als secret bij de Worker staat.
 *  2. De inhoud versleutelen volgens aes128gcm (RFC 8291). De pushdienst kan
 *     de inhoud niet lezen; alleen de browser van de ontvanger kan dat.
 *
 * Dat tweede is de reden dat dit bestand langer is dan je zou verwachten. Het
 * is geen keuze: een pushbericht zonder correcte versleuteling wordt door de
 * browser weggegooid zonder foutmelding.
 */

// ---------------------------------------------------------------------------
// Kleine hulpjes voor base64url, het formaat dat de hele Web Push-keten gebruikt
// ---------------------------------------------------------------------------

export function b64urlNaarBytes(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const binair = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(binair.length);
  for (let i = 0; i < binair.length; i++) bytes[i] = binair.charCodeAt(i);
  return bytes;
}

export function bytesNaarB64url(bytes) {
  let binair = '';
  for (const b of new Uint8Array(bytes)) binair += String.fromCharCode(b);
  return btoa(binair).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function voegSamen(...delen) {
  const totaal = delen.reduce((n, d) => n + d.length, 0);
  const uit = new Uint8Array(totaal);
  let plaats = 0;
  for (const d of delen) {
    uit.set(d, plaats);
    plaats += d.length;
  }
  return uit;
}

const tekstNaarBytes = (s) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// VAPID
// ---------------------------------------------------------------------------

/**
 * Maakt een nieuw VAPID-sleutelpaar. Eenmalig uit te voeren; de publieke
 * sleutel gaat naar de browser, de private naar de secrets van de Worker.
 */
export async function maakVapidSleutels() {
  const paar = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );

  const publiek = await crypto.subtle.exportKey('raw', paar.publicKey);
  const prive = await crypto.subtle.exportKey('jwk', paar.privateKey);

  return {
    publiek: bytesNaarB64url(publiek),
    // Alleen de d-component is de eigenlijke private sleutel.
    prive: prive.d,
  };
}

/** Bouwt de private sleutel terug op uit de opgeslagen d-component. */
async function laadPriveSleutel(priveB64url, publiekB64url) {
  const publiek = b64urlNaarBytes(publiekB64url);
  // Een ongecomprimeerd P-256 punt: 0x04 gevolgd door x en y, elk 32 bytes.
  const x = bytesNaarB64url(publiek.slice(1, 33));
  const y = bytesNaarB64url(publiek.slice(33, 65));

  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: priveB64url, x, y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

/**
 * Het VAPID-JWT voor één pushdienst. De aud-claim is de oorsprong van het
 * endpoint, dus per dienst verschillend.
 */
async function maakVapidJwt({ audience, onderwerp, publiek, prive }) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    // Twaalf uur geldig. Langer wordt door sommige diensten geweigerd.
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: onderwerp,
  };

  const teTekenen = `${bytesNaarB64url(tekstNaarBytes(JSON.stringify(header)))}.${
    bytesNaarB64url(tekstNaarBytes(JSON.stringify(payload)))}`;

  const sleutel = await laadPriveSleutel(prive, publiek);
  const handtekening = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    sleutel,
    tekstNaarBytes(teTekenen),
  );

  return `${teTekenen}.${bytesNaarB64url(handtekening)}`;
}

// ---------------------------------------------------------------------------
// Versleuteling volgens aes128gcm (RFC 8291)
// ---------------------------------------------------------------------------

async function hkdf(zout, ikm, info, lengte) {
  const basis = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: zout, info },
    basis,
    lengte * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Versleutelt de inhoud voor één abonnement.
 *
 * @param {string} inhoud
 * @param {string} p256dh publieke sleutel van de browser, base64url
 * @param {string} auth   gedeeld geheim van de browser, base64url
 */
export async function versleutel(inhoud, p256dh, auth) {
  const ontvangerPubliek = b64urlNaarBytes(p256dh);
  const authGeheim = b64urlNaarBytes(auth);

  // Een verse sleutel per bericht: dat is wat de 'ephemeral' in ECDH betekent.
  const eigenPaar = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const eigenPubliek = new Uint8Array(await crypto.subtle.exportKey('raw', eigenPaar.publicKey));

  const ontvangerSleutel = await crypto.subtle.importKey(
    'raw',
    ontvangerPubliek,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );

  const gedeeld = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: ontvangerSleutel },
      eigenPaar.privateKey,
      256,
    ),
  );

  // De volgorde van deze bytes ligt vast in de standaard; afwijken levert een
  // bericht op dat de browser stil weggooit.
  const prkInfo = voegSamen(
    tekstNaarBytes('WebPush: info\0'),
    ontvangerPubliek,
    eigenPubliek,
  );
  const ikm = await hkdf(authGeheim, gedeeld, prkInfo, 32);

  const zout = crypto.getRandomValues(new Uint8Array(16));
  const sleutelBytes = await hkdf(zout, ikm, tekstNaarBytes('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(zout, ikm, tekstNaarBytes('Content-Encoding: nonce\0'), 12);

  const sleutel = await crypto.subtle.importKey('raw', sleutelBytes, 'AES-GCM', false, ['encrypt']);

  // Een 0x02 als afsluiter markeert het laatste (en enige) blok.
  const teVersleutelen = voegSamen(tekstNaarBytes(inhoud), new Uint8Array([2]));
  const versleuteld = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, sleutel, teVersleutelen),
  );

  // Kopstuk: zout (16) + recordgrootte (4) + lengte publieke sleutel (1) + sleutel (65)
  const recordGrootte = new Uint8Array(4);
  new DataView(recordGrootte.buffer).setUint32(0, 4096);

  return voegSamen(
    zout,
    recordGrootte,
    new Uint8Array([eigenPubliek.length]),
    eigenPubliek,
    versleuteld,
  );
}

// ---------------------------------------------------------------------------
// Versturen
// ---------------------------------------------------------------------------

/**
 * Stuurt één pushbericht.
 *
 * @returns {Promise<{verstuurd: boolean, verlopen?: boolean, reden?: string}>}
 *   verlopen = true betekent dat het abonnement weg mag: de browser is
 *   afgemeld of het toestel bestaat niet meer.
 */
export async function stuurPush(abonnement, bericht, { publiek, prive, onderwerp }) {
  if (!publiek || !prive) return { verstuurd: false, reden: 'geen VAPID-sleutels' };

  let audience;
  try {
    audience = new URL(abonnement.endpoint).origin;
  } catch {
    return { verstuurd: false, verlopen: true, reden: 'ongeldig endpoint' };
  }

  try {
    const [jwt, inhoud] = await Promise.all([
      maakVapidJwt({ audience, onderwerp, publiek, prive }),
      versleutel(JSON.stringify(bericht), abonnement.p256dh, abonnement.auth),
    ]);

    const res = await fetch(abonnement.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${publiek}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '86400',
        Urgency: 'normal',
      },
      body: inhoud,
    });

    if (res.ok) return { verstuurd: true };

    // 404 en 410 betekenen: dit abonnement bestaat niet meer.
    if (res.status === 404 || res.status === 410) {
      return { verstuurd: false, verlopen: true, reden: `status ${res.status}` };
    }

    return { verstuurd: false, reden: `status ${res.status}` };
  } catch (err) {
    return { verstuurd: false, reden: err.message };
  }
}
