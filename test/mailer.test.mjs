/**
 * Tests voor de mailkern: templates, het verstuurpad, de zandbakgrens, en de
 * gebeurtenissen die mail triggeren doorheen de echte Worker.
 */
import { readFileSync } from 'node:fs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import {
  verstuur, isZandbak, ZANDBAK_AFZENDER,
  templateAanduiding, templateVrijgegeven, templateHerinnering,
  templateProbleem, templateWoensdagregel, templateAvondcontrole, templateWeekoverzicht,
} from '../src/lib/mailer.js';

let f = 0;
const check = (n, e, v) => {
  const ok = JSON.stringify(e) === JSON.stringify(v);
  if (!ok) { f++; console.log(`  FOUT ${n}: ${JSON.stringify(e)} != ${JSON.stringify(v)}`); }
  else console.log(`  ok   ${n}`);
};

console.log('\n1. Templates: puur, geen bijwerkingen');
{
  const m = templateAanduiding({
    naam: 'Ann', wedstrijd: 'Bears U12 A - Gent', datum: '2026-09-12', uur: '14:00',
    locatie: 'Sporthal Noord', opkomst: '13:40',
  });
  check('onderwerp bevat de wedstrijd', m.onderwerp, 'Aangeduid: Bears U12 A - Gent');
  check('opkomsttijd in de tekst', /13:40/.test(m.tekst), true);
  check('locatie in de tekst', /Sporthal Noord/.test(m.tekst), true);

  const v = templateVrijgegeven({ naam: 'Ann', wedstrijd: 'Bears U12 A - Gent', datum: '2026-09-12', uur: '14:00' });
  check('vrijgave meldt weer beschikbaar', /beschikbaar/.test(v.tekst), true);

  const h1 = templateHerinnering({ naam: 'Ann', wanneer: 'morgen', wedstrijden: [
    { uur: '14:00', wedstrijd: 'A - B', locatie: 'Noord', opkomst: '13:40' },
  ]});
  check('enkelvoud in onderwerp bij één wedstrijd', h1.onderwerp, 'Herinnering: A - B');

  const h2 = templateHerinnering({ naam: 'Ann', wanneer: 'morgen', wedstrijden: [
    { uur: '14:00', wedstrijd: 'A - B', locatie: 'Noord', opkomst: '13:40' },
    { uur: '16:00', wedstrijd: 'C - D', locatie: 'Zuid', opkomst: '15:40' },
  ]});
  check('meervoud bij meerdere', h2.onderwerp, 'Herinnering: 2 wedstrijden');
  check('beide wedstrijden in de tekst', [/A - B/.test(h2.tekst), /C - D/.test(h2.tekst)], [true, true]);

  const p = templateProbleem({ naam: 'X', wedstrijd: 'A - B', bericht: 'Ziek', official: 'Ann Aerts' });
  check('official en bericht in de tekst', [/Ann Aerts/.test(p.tekst), /Ziek/.test(p.tekst)], [true, true]);

  const w = templateWoensdagregel({ van: '2026-09-12', tot: '2026-09-13', wedstrijden: [
    { datum: '2026-09-12', uur: '14:00', thuis: 'A', uit: 'B', nogNodig: 2 },
  ]});
  check('aantal in onderwerp', w.onderwerp, '1 wedstrijden zonder scheidsrechter dit weekend');

  const a = templateAvondcontrole({ wedstrijden: [{ omschrijving: '2026-09-12 14:00 A - B' }] });
  check('omschrijving in de tekst', /A - B/.test(a.tekst), true);

  const leeg = templateWeekoverzicht({ u10u12: [], overig: [], van: '2026-09-14', tot: '2026-09-21' });
  check('alles aangeduid: geruststellend bericht', /volledig aangeduid/.test(leeg.tekst), true);

  const vol = templateWeekoverzicht({
    van: '2026-09-14', tot: '2026-09-21',
    u10u12: [{ datum: '2026-09-14', uur: '10:00', thuis: 'A', uit: 'B', nogNodig: 1 }],
    overig: [{ datum: '2026-09-14', uur: '18:00', thuis: 'C', uit: 'D', nogNodig: 2 }],
  });
  check('gesplitst in twee secties', [/U10\/U12/.test(vol.tekst), /Overige/.test(vol.tekst)], [true, true]);
}

console.log('\n2. Verstuurpad: ontbrekende configuratie');
{
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { DB: db };

  const zonderAfzender = await verstuur(env, { naar: 'a@b.be', onderwerp: 'X', tekst: 'Y' });
  check('geen afzender', zonderAfzender, { verstuurd: false, reden: 'geen-afzender' });

  db.exec("UPDATE settings SET waarde = 'a@club.be' WHERE sleutel = 'mail_afzender'");
  const zonderSleutel = await verstuur(env, { naar: 'a@b.be', onderwerp: 'X', tekst: 'Y' });
  check('geen sleutel', zonderSleutel, { verstuurd: false, reden: 'geen-sleutel' });
}

console.log('\n3. De zandbakgrens wordt hier afgedwongen, niet bij de aanroeper');
{
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec(`UPDATE settings SET waarde = '${ZANDBAK_AFZENDER}' WHERE sleutel = 'mail_afzender'`);
  const env = { DB: db, RESEND_API_KEY: 're_test' };

  let aangeroepen = false;
  globalThis.fetch = async () => { aangeroepen = true; return { ok: true, json: async () => ({}) }; };

  const naarAnder = await verstuur(env, { naar: 'iemand.anders@club.be', onderwerp: 'X', tekst: 'Y' });
  check('geweigerd zonder Resend aan te roepen', naarAnder, { verstuurd: false, reden: 'zandbak-andere-ontvanger' });
  check('fetch niet aangeroepen', aangeroepen, false);

  const naarZichzelf = await verstuur(env, { naar: ZANDBAK_AFZENDER, onderwerp: 'X', tekst: 'Y' });
  check('naar het geregistreerde adres mag wel', naarZichzelf.verstuurd, true);
  check('en roept Resend nu wel aan', aangeroepen, true);

  check('isZandbak herkent hoofdletters', isZandbak('Onboarding@Resend.Dev'), true);
  check('isZandbak op een echt domein', isZandbak('a@jouwclub.be'), false);
}

console.log('\n4. Verstuurpad: geslaagd en mislukt');
{
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.exec("UPDATE settings SET waarde = 'aanduidingen@jouwclub.be' WHERE sleutel = 'mail_afzender'");
  const env = { DB: db, RESEND_API_KEY: 're_test' };

  globalThis.fetch = async (url, opties) => {
    const body = JSON.parse(opties.body);
    check('juiste afzender', body.from, 'YOAssist <aanduidingen@jouwclub.be>');
    return { ok: true, json: async () => ({ id: 'x' }) };
  };
  const ok = await verstuur(env, { naar: 'yo@club.be', onderwerp: 'Test', tekst: 'Inhoud' });
  check('geslaagd', ok, { verstuurd: true });

  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ message: 'geweigerd' }) });
  const mislukt = await verstuur(env, { naar: 'yo@club.be', onderwerp: 'Test', tekst: 'Inhoud' });
  check('mislukt met reden', mislukt, { verstuurd: false, reden: 'geweigerd' });

  globalThis.fetch = async () => { throw new Error('netwerk weg'); };
  const netwerkfout = await verstuur(env, { naar: 'yo@club.be', onderwerp: 'Test', tekst: 'Inhoud' });
  check('netwerkfout vangt niet crashen', netwerkfout, { verstuurd: false, reden: 'netwerk weg' });
}

// ---------------------------------------------------------------------------
// Gebeurtenissen door de echte Worker.
// ---------------------------------------------------------------------------
const CLUB = 'BVBL1125';
const morgen = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function nieuweEnv({ metMail = true } = {}) {
  const db = new D1Shim();
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  if (metMail) db.exec("UPDATE settings SET waarde = 'aanduidingen@jouwclub.be' WHERE sleutel = 'mail_afzender'");
  const d = morgen();
  db.exec(`
    INSERT INTO clubs (guid, naam) VALUES ('${CLUB}', 'Leuven Bears');
    INSERT INTO teams (guid, club_guid, naam, cat_code) VALUES ('${CLUB}G12  1', '${CLUB}', 'G12 A', 'G12');
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid) VALUES
      ('baas@club.be', 'Jurgen', 'van Geijstelen', 1, 'YO+', '${CLUB}'),
      ('ann@club.be',  'Ann',    'Aerts',          0, 'YO',  '${CLUB}');
    INSERT INTO matches (guid, seizoen, club_guid, thuis_guid, thuis_naam, uit_naam,
                         datum, uur, locatie, cat_code, off_namen, off_aantal, scope, scope_reden, hash) VALUES
      ('U12A','2627','${CLUB}','${CLUB}G12  1','G12 A','Gast','${d}','14:00','Sporthal Noord','G12','[]',0,1,'auto','h1');
  `);
  return { DB: db, ENVIRONMENT: 'development', RESEND_API_KEY: metMail ? 're_test' : undefined };
}

async function vraag(env, pad, { methode = 'GET', alsWie = 'baas@club.be', body = null } = {}) {
  const opties = { method: methode };
  if (body !== null) { opties.body = JSON.stringify(body); opties.headers = { 'Content-Type': 'application/json' }; }
  const res = await worker.fetch(new Request(`http://localhost${pad}`, opties), { ...env, DEV_EMAIL: alsWie }, {});
  let json = null;
  try { json = await res.clone().json(); } catch { /* geen JSON */ }
  return { status: res.status, json };
}

console.log('\n5. Toewijzen stuurt mail');
{
  const env = nieuweEnv();
  const verzonden = [];
  globalThis.fetch = async (url, opties) => {
    verzonden.push(JSON.parse(opties.body));
    return { ok: true, json: async () => ({}) };
  };

  const r = await vraag(env, '/api/admin/aanduiding', {
    methode: 'POST', body: { matchGuid: 'U12A', email: 'ann@club.be' },
  });
  check('toewijzing gelukt', r.status, 200);
  check('mail als verstuurd gemeld', r.json.mailVerstuurd, true);
  check('één mail verstuurd', verzonden.length, 1);
  check('naar de juiste official', verzonden[0].to, 'ann@club.be');
  check('over de juiste wedstrijd', /G12 A/.test(verzonden[0].text), true);
}

console.log('\n6. Toewijzen lukt ook als mail niet geconfigureerd is');
{
  const env = nieuweEnv({ metMail: false });
  const r = await vraag(env, '/api/admin/aanduiding', {
    methode: 'POST', body: { matchGuid: 'U12A', email: 'ann@club.be' },
  });
  check('toewijzing lukt zonder mailconfiguratie', r.status, 200);
  check('mail netjes gemeld als niet verstuurd', r.json.mailVerstuurd, false);
  const rij = await env.DB.prepare('SELECT status FROM assignments WHERE match_guid=? AND user_email=?')
    .bind('U12A', 'ann@club.be').first();
  check('de aanduiding zelf staat er wel', rij.status, 'toegewezen');
}

console.log('\n7. Vrijgeven stuurt mail');
{
  const env = nieuweEnv();
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  await vraag(env, '/api/admin/aanduiding', { methode: 'POST', body: { matchGuid: 'U12A', email: 'ann@club.be' } });

  const verzonden = [];
  globalThis.fetch = async (url, opties) => { verzonden.push(JSON.parse(opties.body)); return { ok: true, json: async () => ({}) }; };

  const r = await vraag(env, '/api/admin/aanduiding?matchGuid=U12A&email=ann@club.be', { methode: 'DELETE' });
  check('vrijgeven gelukt', r.status, 200);
  check('mail verstuurd', r.json.mailVerstuurd, true);
  check('onderwerp meldt vervallen', /vervallen/.test(verzonden[0].subject), true);
}

console.log('\n8. Probleem melden bereikt alle actieve beheerders');
{
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid, actief) VALUES
      ('tweede@club.be', 'Fluppe', 'Van Meerbeeck', 1, 'YO+', '${CLUB}', 1),
      ('oud@club.be', 'Oud', 'Beheerder', 1, 'YO+', '${CLUB}', 0);
  `);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  await vraag(env, '/api/admin/aanduiding', { methode: 'POST', body: { matchGuid: 'U12A', email: 'ann@club.be' } });

  const verzonden = [];
  globalThis.fetch = async (url, opties) => { verzonden.push(JSON.parse(opties.body).to); return { ok: true, json: async () => ({}) }; };

  await vraag(env, '/api/probleem', {
    methode: 'POST', alsWie: 'ann@club.be', body: { matchGuid: 'U12A', bericht: 'Ziek geworden' },
  });
  check('naar beide actieve beheerders', verzonden.sort(), ['baas@club.be', 'tweede@club.be']);
  check('niet naar de inactieve', verzonden.includes('oud@club.be'), false);
}

console.log('\n9. De woensdagregel stuurt naar YO+, niet naar gewone YO');
{
  const env = nieuweEnv();
  env.DB.exec(`
    INSERT INTO users (email, voornaam, achternaam, profiel, club_guid) VALUES
      ('yo@club.be', 'Gewone', 'YO', 'YO', '${CLUB}');
    UPDATE matches SET scope = 0, scope_reden = NULL, off_aantal = 0, datum = '2026-09-12' WHERE guid = 'U12A';
  `);
  const verzonden = [];
  globalThis.fetch = async (url, opties) => { verzonden.push(JSON.parse(opties.body).to); return { ok: true, json: async () => ({}) }; };

  // Woensdag 14:00 Brussel = 12:00 UTC in de zomer, weekend erna: 12-13 september
  const ctx = { waitUntil: (p) => p };
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-09T12:00:00Z') }, env, ctx);
  await new Promise((r) => setTimeout(r, 0));

  check('minstens de YO+-gebruikers bereikt', verzonden.includes('baas@club.be'), true);
  check('niet de gewone YO', verzonden.includes('yo@club.be'), false);
}

console.log('\n10. De avondcontrole mailt de beheerders');
{
  const env = nieuweEnv();
  env.DB.exec(`UPDATE matches SET scope = 1, scope_reden = 'woensdag', off_aantal = 2, datum = '2026-09-12' WHERE guid = 'U12A'`);

  const verzonden = [];
  globalThis.fetch = async (url, opties) => { verzonden.push(JSON.parse(opties.body)); return { ok: true, json: async () => ({}) }; };

  const ctx = { waitUntil: (p) => p };
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-08T18:00:00Z') }, env, ctx); // 20:00 Brussel
  await new Promise((r) => setTimeout(r, 0));

  check('beheerder bereikt', verzonden.some((m) => m.to === 'baas@club.be'), true);
  check('vermeldt de wedstrijd', /G12 A/.test(verzonden[0].text), true);
}

console.log('\n11. Het weekoverzicht op maandagochtend');
{
  const env = nieuweEnv();
  env.DB.exec(`UPDATE matches SET datum = '2026-09-08' WHERE guid = 'U12A'`);
  const verzonden = [];
  globalThis.fetch = async (url, opties) => { verzonden.push(JSON.parse(opties.body)); return { ok: true, json: async () => ({}) }; };

  // Maandag 08:00 Brussel = 06:00 UTC in de zomer (2026-09-07 is een maandag)
  const ctx = { waitUntil: (p) => p };
  await worker.scheduled({ scheduledTime: Date.parse('2026-09-07T06:00:00Z') }, env, ctx);
  await new Promise((r) => setTimeout(r, 0));

  check('beheerder bereikt', verzonden.length >= 1, true);
  check('gaat over de open wedstrijd', /G12 A/.test(verzonden[0].text), true);
}

console.log(f === 0 ? '\n=== ALLE MAILERTESTS GESLAAGD ===' : `\n=== ${f} GEFAALD ===`);
process.exit(f ? 1 : 0);
