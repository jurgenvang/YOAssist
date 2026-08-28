import { fout, json } from '../../lib/http.js';
import { clubWedstrijden, normaliseerGuid, CLUB_GUID_PATROON, VblError } from '../../lib/vbl.js';

/**
 * GET /api/admin/diagnose-matches?guid=BVBL1125[&n=2][&veld=wedOff]
 *
 * Toont ruwe wedstrijdrecords zoals Basketbal Vlaanderen ze teruggeeft, zonder
 * iets te bewaren. Bedoeld om vast te stellen hoe velden er werkelijk uitzien
 * voor er code op gebouwd wordt — in het bijzonder wedOff (de aangeduide
 * scheidsrechters) en of er een verwijzing naar het wedstrijdblad in zit.
 *
 * Zonder ?veld= krijg je een samenvatting: welke sleutels bestaan, welke altijd
 * leeg zijn, en twee volledige voorbeeldrecords. Dat is meestal genoeg en
 * scheelt een muur van JSON.
 */
export async function diagnoseMatches({ url, env }) {
  const guid = normaliseerGuid(url.searchParams.get('guid') ?? '').toUpperCase();
  const aantal = Math.min(Number(url.searchParams.get('n') ?? 2) || 2, 10);
  const veld = url.searchParams.get('veld');

  if (!CLUB_GUID_PATROON.test(guid)) {
    return fout(400, 'Ongeldige GUID', 'Een club-GUID heeft de vorm BVBL gevolgd door vier cijfers.');
  }

  let lijst;
  try {
    lijst = await clubWedstrijden(guid);
  } catch (err) {
    return fout(502, 'Basketbal Vlaanderen', err instanceof VblError ? err.message : String(err));
  }

  if (lijst.length === 0) {
    return json({ guid, aantalWedstrijden: 0, opmerking: 'De API gaf geen wedstrijden terug.' });
  }

  // Eén specifiek veld opvragen: geeft alle voorkomende waarden, gegroepeerd.
  if (veld) {
    const waarden = new Map();
    for (const w of lijst) {
      const sleutel = JSON.stringify(w[veld] ?? null);
      waarden.set(sleutel, (waarden.get(sleutel) ?? 0) + 1);
    }
    return json({
      guid,
      veld,
      aantalWedstrijden: lijst.length,
      verschillendeWaarden: waarden.size,
      waarden: [...waarden.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40)
        .map(([waarde, keer]) => ({ waarde: JSON.parse(waarde), keer })),
    });
  }

  // Overzicht van alle sleutels, met hoe vaak ze gevuld zijn.
  const sleutels = new Map();
  for (const w of lijst) {
    for (const [k, v] of Object.entries(w)) {
      const stat = sleutels.get(k) ?? { gevuld: 0, voorbeeld: null };
      const leeg = v === null || v === undefined || v === '';
      if (!leeg) {
        stat.gevuld++;
        if (stat.voorbeeld === null) stat.voorbeeld = v;
      }
      sleutels.set(k, stat);
    }
  }

  return json({
    guid,
    aantalWedstrijden: lijst.length,
    velden: [...sleutels.entries()]
      .map(([naam, s]) => ({
        naam,
        gevuld: `${s.gevuld}/${lijst.length}`,
        voorbeeld: typeof s.voorbeeld === 'string' ? s.voorbeeld.slice(0, 120) : s.voorbeeld,
      }))
      .sort((a, b) => a.naam.localeCompare(b.naam)),
    voorbeelden: lijst.slice(0, aantal),
  });
}
