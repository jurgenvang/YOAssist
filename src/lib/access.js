/**
 * Identiteit uit Cloudflare Access, met twee wegen.
 *
 * 1. Access voor Workers (sinds augustus 2026). De policy hangt aan de Worker
 *    zelf en dekt ook workers.dev en preview-URL's. De identiteit komt dan
 *    kant-en-klaar binnen via ctx.access — geen JWT-verificatie nodig.
 *
 * 2. Terugval op JWT-verificatie. Nodig omdat een Worker met static assets
 *    achter een interne router draait, en die geeft ctx.access niet door.
 *    Access beschermt de app dan nog steeds, maar wij moeten het token zelf
 *    controleren. Daarvoor is CF_ACCESS_TEAM_DOMAIN en CF_ACCESS_AUD nodig.
 *
 * De aud-controle in weg 2 is niet optioneel: zonder die vergelijking zou een
 * geldig token van gelijk welke andere Access-applicatie hier ook werken.
 */

const CERTS_TTL_MS = 60 * 60 * 1000;
let certsCache = { url: null, keys: null, fetchedAt: 0 };

export class AuthError extends Error {}

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

export async function verifyAccessJwt(token, { teamDomain, aud }) {
  if (!teamDomain || !aud) {
    throw new AuthError(
      'CF_ACCESS_TEAM_DOMAIN of CF_ACCESS_AUD ontbreekt. Die zijn nodig zolang ' +
        'ctx.access niet beschikbaar is (Worker met static assets).',
    );
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('token heeft geen drie segmenten');

  const [headerSeg, payloadSeg, signatureSeg] = parts;
  const header = decodeJsonSegment(headerSeg);
  if (header.alg !== 'RS256') throw new AuthError(`onverwacht algoritme: ${header.alg}`);

  const keys = await getSigningKeys(teamDomain);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AuthError('geen publieke sleutel voor deze kid');

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
 * @param {Request} request
 * @param {object} env
 * @param {ExecutionContext} ctx — kan ctx.access bevatten
 * @returns {Promise<{email: string, via: string}>}
 */
export async function identify(request, env, ctx) {
  // Weg 1: Access voor Workers.
  if (ctx?.access) {
    const identiteit = await ctx.access.getIdentity();
    if (identiteit?.email) {
      return { email: String(identiteit.email).toLowerCase(), via: 'access-worker' };
    }
  }

  // Ontwikkelterugval. Werkt uitsluitend op localhost én alleen wanneer
  // ENVIRONMENT en DEV_EMAIL allebei gezet zijn. Die staan in .dev.vars, dat
  // niet in git zit en niet mee gedeployd wordt.
  const hostname = new URL(request.url).hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocalhost && env.ENVIRONMENT === 'development' && env.DEV_EMAIL) {
    return { email: env.DEV_EMAIL.toLowerCase(), via: 'dev-fallback' };
  }

  // Weg 2: het token zelf verifiëren.
  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    (request.headers.get('Cookie') || '').match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];

  if (!token) throw new AuthError('geen Access-token op dit verzoek');

  const claims = await verifyAccessJwt(token, {
    teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
    aud: env.CF_ACCESS_AUD,
  });

  return { email: String(claims.email).toLowerCase(), via: 'access-jwt' };
}
