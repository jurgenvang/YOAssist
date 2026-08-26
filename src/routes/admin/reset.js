import { json, fout, leesJson } from '../../lib/http.js';
import { log } from '../../lib/logboek.js';

/**
 * Resetten per onderdeel.
 *
 * Vier niveaus, oplopend ingrijpend. De twee zwaarste vragen dat de beheerder
 * de clubnaam overtypt: die extra seconde is precies wat een verkeerde klik
 * tegenhoudt, en een gewone bevestigingsknop biedt die seconde niet.
 *
 * Wat elk niveau wist, staat hieronder in tabelvorm en niet verspreid door de
 * code. Iemand die zich afvraagt wat er verdwijnt, moet dat op één plaats
 * kunnen nalezen.
 */

export const NIVEAUS = {
  wedstrijden: {
    label: 'Wedstrijden opnieuw ophalen',
    uitleg:
      'Wist alle wedstrijden, beschikbaarheden en aanduidingen. Ploegen, ' +
      'gebruikers en clubs blijven staan. Na een synchronisatie staat de ' +
      'kalender er weer, maar leeg qua antwoorden.',
    tabellen: ['assignments', 'availability', 'problemen', 'matches'],
    bevestiging: 'knop',
  },
  teams: {
    label: 'Ploegen en wedstrijden',
    uitleg:
      'Zoals hierboven, plus de ploegen en hun vinkjes. Je moet daarna opnieuw ' +
      'teams laden en aanvinken welke je wil volgen.',
    tabellen: ['assignments', 'availability', 'problemen', 'matches', 'teams'],
    bevestiging: 'knop',
  },
  clubgegevens: {
    label: 'Alles behalve gebruikers',
    uitleg:
      'Zoals hierboven, plus de clubs en het logboek. Gebruikers, hun ' +
      'voorkeuren en de instellingen blijven. Categorieën en tarieven blijven ook.',
    tabellen: [
      'assignments', 'availability', 'problemen', 'matches', 'teams',
      'logboek', 'sync_runs', 'clubs',
    ],
    bevestiging: 'naam',
  },
  alles: {
    label: 'Volledig opnieuw beginnen',
    uitleg:
      'Wist alles, ook de gebruikers en hun push-abonnementen. Enkel jouw eigen ' +
      'account blijft over, zodat je niet buitengesloten raakt. Categorieën en ' +
      'tarieven blijven, want die zijn geen clubgegevens.',
    tabellen: [
      'assignments', 'availability', 'problemen', 'matches', 'teams',
      'logboek', 'sync_runs', 'push_abonnementen', 'clubs',
    ],
    bevestiging: 'naam',
    raaktGebruikers: true,
  },
};

/**
 * GET /api/admin/reset — wat elk niveau zou wissen, met de huidige aantallen.
 *
 * De aantallen erbij zetten is geen luxe: '412 rijen' laat een beheerder
 * anders aarzelen op precies het juiste moment.
 */
export async function overzichtReset({ env, user }) {
  const tellingen = {};
  const tabellen = [
    'clubs', 'teams', 'matches', 'availability', 'assignments',
    'problemen', 'logboek', 'sync_runs', 'users', 'push_abonnementen',
  ];

  for (const tabel of tabellen) {
    const rij = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${tabel}`).first().catch(() => null);
    tellingen[tabel] = rij?.n ?? 0;
  }

  const club = await env.DB.prepare('SELECT naam FROM clubs ORDER BY naam LIMIT 1').first();

  return json({
    tellingen,
    // Wat er overgetypt moet worden bij de zware niveaus. Zonder club valt er
    // niets te bevestigen, en dan is er ook weinig te wissen.
    bevestigWoord: club?.naam ?? null,
    niveaus: Object.entries(NIVEAUS).map(([sleutel, n]) => ({
      sleutel,
      label: n.label,
      uitleg: n.uitleg,
      bevestiging: n.bevestiging,
      raakt: n.tabellen.map((tabel) => ({ tabel, aantal: tellingen[tabel] ?? 0 })),
      totaal: n.tabellen.reduce((s, tabel) => s + (tellingen[tabel] ?? 0), 0) +
        (n.raaktGebruikers ? Math.max(0, (tellingen.users ?? 0) - 1) : 0),
    })),
  });
}

/**
 * POST /api/admin/reset   { niveau, bevestiging? }
 *
 * Wist in de volgorde van de tabellenlijst, die zo is opgesteld dat kinderen
 * vóór ouders verdwijnen. Op cascade vertrouwen zou werken, maar dan hangt het
 * resultaat af van hoe de foreign keys toevallig staan.
 */
export async function reset({ request, env, user }) {
  const body = await leesJson(request);
  const niveau = NIVEAUS[body.niveau];

  if (!niveau) {
    return fout(
      400,
      'Onbekend niveau',
      `Kies een van: ${Object.keys(NIVEAUS).join(', ')}.`,
    );
  }

  if (niveau.bevestiging === 'naam') {
    const club = await env.DB.prepare('SELECT naam FROM clubs ORDER BY naam LIMIT 1').first();
    const verwacht = (club?.naam ?? '').trim().toLowerCase();
    const gegeven = String(body.bevestiging ?? '').trim().toLowerCase();

    if (!verwacht) {
      return fout(
        409,
        'Geen club om te bevestigen',
        'Er staat geen club ingesteld, dus er valt weinig te wissen.',
      );
    }
    if (gegeven !== verwacht) {
      return fout(
        400,
        'Bevestiging klopt niet',
        `Typ de naam van de club over om dit te bevestigen.`,
      );
    }
  }

  // Voor later, wanneer er afgesloten maanden bestaan: die mogen nooit
  // verdwijnen achter een resetknop. De tabel bestaat nog niet, dus de
  // controle slaagt vanzelf tot ze er is.
  const afgesloten = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM afgesloten_maanden")
    .first()
    .catch(() => null);

  if (afgesloten && afgesloten.n > 0) {
    return fout(
      409,
      'Er zijn afgesloten maanden',
      'Facturatie is al afgesloten voor een of meer maanden. Die gegevens mogen niet gewist worden.',
    );
  }

  const gewist = {};

  for (const tabel of niveau.tabellen) {
    const res = await env.DB.prepare(`DELETE FROM ${tabel}`).run().catch(() => null);
    gewist[tabel] = res?.meta?.changes ?? 0;
  }

  if (niveau.raaktGebruikers) {
    // Het eigen account blijft over: anders raakt de beheerder buitengesloten
    // en is er niemand meer om iets recht te zetten.
    const res = await env.DB.prepare('DELETE FROM users WHERE email != ?')
      .bind(user.email)
      .run();
    gewist.users = res?.meta?.changes ?? 0;

    // De clubkoppeling van het overgebleven account wijst nu naar niets.
    await env.DB.prepare('UPDATE users SET club_guid = NULL WHERE email = ?')
      .bind(user.email)
      .run();
  }

  // Het logboek zelf kan zonet gewist zijn; deze regel is dan de eerste.
  await log(env.DB, {
    categorie: 'beheer',
    soort: 'reset',
    wie: user.email,
    veld: niveau.label,
    nieuw: Object.entries(gewist)
      .filter(([, n]) => n > 0)
      .map(([tabel, n]) => `${tabel}: ${n}`)
      .join(', ') || 'niets te wissen',
  });

  return json({
    niveau: body.niveau,
    label: niveau.label,
    gewist,
    totaal: Object.values(gewist).reduce((s, n) => s + n, 0),
  });
}
