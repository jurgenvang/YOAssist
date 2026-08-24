# YOAssist opzetten

Eén Worker doet alles: de app, de API en de geplande synchronisatie. Er is geen
tweede project meer nodig.

De databank staat er al (`696c9518-702e-4e9f-9832-38c6bb10c6f6`) en is al
ingevuld in `wrangler.toml`.

---

## Stap 1 — De tabellen aanmaken

Kan via de D1-console in het dashboard: **Storage & Databases → D1 → yoassist →
Console**. Plak de inhoud van `schema-console.sql`. Werkt de console alleen met
één statement tegelijk, plak dan blok per blok in volgorde — `users` en `teams`
verwijzen naar `clubs`, en `availability` naar `matches`.

Controle:

```sql
SELECT name FROM sqlite_master
WHERE type='table' AND name NOT LIKE '\_cf\_%' ESCAPE '\'
ORDER BY name;
```

Acht namen: `availability`, `clubs`, `match_changes`, `matches`, `settings`,
`sync_runs`, `teams`, `users`. (`_cf_KV` is van D1 zelf en hoort erbij.)

Daarna `seed-console.sql` met jouw adressen erin.

---

## Stap 2 — De code naar GitHub

Volledig in de browser: repo aanmaken → **uploading an existing file** → de
**inhoud** van de map slepen (`src`, `public`, `wrangler.toml`, de sql-bestanden).

Controleer daarna dat `wrangler.toml` en `src/` in de **hoofdmap** staan, en dat
er geen `package.json` naast staat.

---

## Stap 3 — Het Worker-project

Heb je al een Worker-project met deze repo gekoppeld, dan hoef je niets opnieuw
aan te maken. Ga naar **Settings → Build** en zet:

| Veld | Waarde |
| --- | --- |
| Build command | *leeg* |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

Dat deploycommando is nu het juiste: het project *is* een Worker.

Nog geen project? **Workers & Pages → Create → Workers → Import a repository**.

Na de deploy heb je `yoassist.<jouw-subdomein>.workers.dev`.

---

## Stap 4 — Controleren of de bindings meekwamen

`wrangler.toml` is de bron van waarheid: de D1-binding, de assets en de cron
staan erin en worden bij de deploy toegepast. Controleer in het dashboard:

- **Settings → Bindings**: `DB` (D1) en `ASSETS` staan er
- **Settings → Trigger Events**: acht cron-uren staan er

Staat daar niets, dan is `wrangler.toml` niet gevonden — dan zit hij niet in de
hoofdmap van de repo.

---

## Stap 5 — Access aanzetten

Dit is nu eenvoudiger dan bij Pages. In het dashboard:

**Workers & Pages → yoassist → Settings → Domains & Routes**, en klik bij
workers.dev op **Enable Cloudflare Access**. Of via het tabblad **Access** op de
Worker: **Protect this Worker behind Access** → **All traffic**.

Kies bij de policy: toegang op basis van **e-mailadres**, en plak de adressen van
je Youth Officials en jezelf.

De policy hangt aan de Worker, niet aan een hostnaam. Voeg je later een eigen
domein toe, dan is dat automatisch mee beschermd.

---

## Stap 6 — De twee variabelen invullen

Ga naar **Zero Trust → Access → Applications**, open de applicatie die bij stap
5 is aangemaakt, en noteer:

- je **teamdomein** (`jouwteam.cloudflareaccess.com`, staat onder Settings)
- de **Application Audience (AUD) Tag**

Vul die in `wrangler.toml` in en push:

```toml
[vars]
CF_ACCESS_TEAM_DOMAIN = "jouwteam.cloudflareaccess.com"
CF_ACCESS_AUD = "de-aud-tag"
```

**Waarom dit nodig is ook al hebben we Access voor Workers:** een Worker met
static assets draait achter een interne router, en die geeft `ctx.access` niet
door aan jouw code. De app valt dan terug op het zelf verifiëren van het
Access-token, en daarvoor zijn deze twee waarden nodig. Sla je dit over, dan
kom je wel door het loginscherm maar krijg je daarna overal 401.

---

## Stap 7 — Testen

Open je workers.dev-URL in een **privévenster**. Je krijgt het Access-scherm,
vult je adres in, plakt de code uit je mailbox.

In deze volgorde testen:

1. **Jouw adminadres** — je ziet YOAssist met je naam en de drie puntjes.
2. **De drie puntjes** — vul je club-GUID in en klik **Controleer**. Verschijnt
   de clubnaam met een aantal teams, dan werkt de koppeling met Basketbal
   Vlaanderen. Dit is de belangrijkste test.
3. **Club toevoegen → Teams laden → ploegen aanvinken → Nu synchroniseren.**
4. **Gebruikers aan de club koppelen.** In de D1-console:
   ```sql
   UPDATE users SET club_guid = 'BVBL....';
   ```
   Zonder deze stap ziet niemand wedstrijden; de app meldt dat ook.
5. **Een YO-account** (`is_admin = 0`) — geen drie puntjes, en `/api/admin/config`
   rechtstreeks opvragen geeft 403.

---

## Als er iets misgaat

**Overal 401 na inloggen** — `CF_ACCESS_AUD` of `CF_ACCESS_TEAM_DOMAIN` niet
ingevuld, of de push met die waarden is nog niet gedeployd.

**"token hoort bij een andere applicatie"** — de AUD-tag komt van een andere
Access-applicatie. Kijk in Zero Trust → Access → Applications welke er bij deze
Worker hoort.

**"Niet in de ledenlijst"** — het adres raakt wel door Access maar staat niet in
`users`, of niet in kleine letters.

**Foutmelding met `DB` erin** — de D1-binding ontbreekt. Zie stap 4.

**De controleknop vindt nul teams** — roep
`/api/admin/resolve-club?guid=BVBL....&diagnose=1` op in je browser. Die geeft de
ruwe structuur van het antwoord terug; daarmee kan de parser bijgesteld worden.

---

## Wijzigingen doorvoeren

Via github.com: blader naar het bestand, potlood rechtsboven, aanpassen,
**Commit changes**. De Worker wordt automatisch opnieuw gedeployd. Alles zit nu
in één project, dus er is niets meer dat je apart moet bijwerken.
