/**
 * Verificatie van het Cloudflare Access JWT.
 *
 * Access zet bij elk verzoek naar de origin de header Cf-Access-Jwt-Assertion.
 * De aanwezigheid van die header betekent niets: ze moet cryptografisch
 * geverifieerd worden tegen de publieke sleutels van jouw team, én de aud-claim
 * moet overeenkomen met JOUW applicatie. Zonder die aud-check is een geldig
 * token van gelijk welke andere Access-applicatie hier ook bruikbaar.
 */

const CERTS_TTL_MS = 60 * 60 * 1000;

// Module-scope cache. Blijft leven zolang de isolate leeft; bij een koude start
// wordt gewoon opnieuw gefetcht.
let certsCache = { url: null, keys: null, fetchedAt: 0 };

function base64UrlToBytes(input) {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

async function getSigningKeys(teamDomain) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const now = Date.now();

  if (certsCache.url === url && certsCache.keys && now - certsCache.fetchedAt < CERTS_TTL_MS) {
    return certsCache.keys;
  }

  const res = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new AuthError(`kon Access-certificaten niet ophalen (${res.status})`);

  const body = await res.json();
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new AuthError('Access-certificaten bevatten geen sleutels');
  }

  certsCache = { url, keys: body.keys, fetchedAt: now };
  return body.keys;
}

export class AuthError extends Error {}

/**
 * @returns {Promise<{email: string, sub: string, exp: number}>} de geverifieerde claims
 */
export async function verifyAccessJwt(token, { teamDomain, aud }) {
  if (!teamDomain || !aud) {
    throw new AuthError('CF_ACCESS_TEAM_DOMAIN of CF_ACCESS_AUD ontbreekt in de omgeving');
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('token heeft geen drie segmenten');

  const [headerSeg, payloadSeg, signatureSeg] = parts;
  const header = decodeJsonSegment(headerSeg);
  if (header.alg !== 'RS256') throw new AuthError(`onverwacht algoritme: ${header.alg}`);

  const keys = await getSigningKeys(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError('geen publieke sleutel voor deze kid');

  // Alleen de velden meegeven die WebCrypto verwacht; Cloudflare stuurt soms
  // extra velden mee die importKey doen struikelen.
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(signatureSeg),
    new TextEncoder().encode(`${headerSeg}.${payloadSeg}`),
  );
  if (!valid) throw new AuthError('ongeldige handtekening');

  const claims = decodeJsonSegment(payloadSeg);
  const now = Math.floor(Date.now() / 1000);

  if (typeof claims.exp !== 'number' || claims.exp <= now) throw new AuthError('token verlopen');
  if (typeof claims.nbf === 'number' && claims.nbf > now + 60) throw new AuthError('token nog niet geldig');
  if (claims.iss !== `https://${teamDomain}`) throw new AuthError('verkeerde issuer');

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(aud)) throw new AuthError('token hoort bij een andere applicatie');

  if (!claims.email) throw new AuthError('token bevat geen e-mailadres');

  return claims;
}

/**
 * Haalt de identiteit uit het verzoek.
 *
 * De dev-fallback werkt uitsluitend op localhost én alleen wanneer ENVIRONMENT
 * en DEV_EMAIL allebei gezet zijn. Die staan in .dev.vars, dat niet in git zit
 * en niet mee gedeployed wordt. Zet ze nooit in wrangler.toml.
 */
export async function identify(request, env) {
  const hostname = new URL(request.url).hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

  if (isLocalhost && env.ENVIRONMENT === 'development' && env.DEV_EMAIL) {
    return { email: env.DEV_EMAIL.toLowerCase(), via: 'dev-fallback' };
  }

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    (request.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];

  if (!token) throw new AuthError('geen Access-token op dit verzoek');

  const claims = await verifyAccessJwt(token, {
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    aud: env.CF_ACCESS_AUD,
  });

  return { email: String(claims.email).toLowerCase(), via: 'access' };
}
