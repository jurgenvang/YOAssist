# YOAssist opzetten zonder terminal

Alles kan via de webinterface. Je hebt een browser nodig en verder niets — geen
Node, geen wrangler, geen commandoregel.

De volgorde is niet vrijblijvend: elke stap gebruikt iets uit de vorige.

---

## Stap 1 — De tabellen aanmaken (D1-console)

Cloudflare-dashboard → **Storage & Databases** → **D1** → jouw databank →
tabblad **Console**.

Open `schema-console.sql` en plak de volledige inhoud in het invoerveld. Klik
**Execute**.

Krijg je een foutmelding of blijft het bij één tabel, plak dan blok per blok.
Het bestand is opgedeeld in acht genummerde blokken; voer ze uit in volgorde,
want `users` en `teams` verwijzen naar `clubs`, en `availability` verwijst naar
`matches`.

**Controle.** Voer uit in dezelfde console:

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';
```

Je hoort acht namen te zien: `settings`, `clubs`, `users`, `teams`, `matches`,
`match_changes`, `availability`, `sync_runs`.

---

## Stap 2 — Jezelf als beheerder toevoegen

Open `seed-console.sql`, vervang de voorbeeldadressen door echte, en plak het in
dezelfde console.

Het adres op de eerste regel is het jouwe en krijgt `is_admin = 1`. Gebruik
**exact** het adres waarmee je straks via Access inlogt, in kleine letters.
Zonder deze rij kom je nergens: je raakt wel door Access, maar YOAssist kent je
niet.

**Controle.**

```sql
SELECT email, is_admin, profiel FROM users;
```

---

## Stap 3 — De code op GitHub krijgen

Ook dit kan volledig in de browser.

1. Ga naar **github.com** → **New repository** → naam `yoassist` → **Create**.
2. Op de lege repo-pagina: **uploading an existing file**.
3. Pak `yoassist.zip` lokaal uit en sleep de **inhoud** van de map naar het
   uploadvenster — dus `public`, `functions`, `cron`, `schema.sql`,
   `wrangler.toml` enzovoort, niet de map zelf.
4. Onderaan **Commit changes**.

Controleer daarna op github.com dat de map `functions` er staat met daarin
`api/`. Ontbreekt die, dan werkt straks niets: Pages haalt daar zijn backend uit.

Sleep `node_modules` niet mee als die map bij je staat. En zorg dat er **geen
`package.json` of `package-lock.json` in de hoofdmap** belandt: Pages ziet die
en gaat dan een npm-installatie draaien voor een app die geen buildstap heeft.
De enige `package.json` in dit project staat in `test/`, en die hoort daar.

---

## Stap 4 — De app publiceren (Pages)

Dashboard → **Workers & Pages** → **Create** → tabblad **Pages** →
**Connect to Git** → kies je `yoassist`-repo.

Bij de buildinstellingen:

| Veld | Waarde |
| --- | --- |
| Framework preset | None |
| Build command | *leeg laten* |
| Build output directory | `public` |

**Save and Deploy.** Na een halve minuut heb je een URL zoals
`yoassist.pages.dev`. Noteer die.

De site is nu bereikbaar maar doet niets: zonder Access-configuratie geeft elke
`/api/`-aanroep een 401. Dat is de bedoeling — hij faalt dicht, niet open.

---

## Stap 5 — De databank aan de app koppelen

Pages → je project → **Settings** → **Bindings** → **Add** → **D1 database**.

| Veld | Waarde |
| --- | --- |
| Variable name | `DB` |
| D1 database | jouw yoassist-databank |

Doe dit voor **Production** en voor **Preview**. Dat zijn twee aparte bindings;
vergeet je de tweede, dan werkt elke preview-deploy niet.

---

## Stap 6 — Access instellen

Dashboard → **Zero Trust**. Bij de eerste keer kies je een teamnaam; je domein
wordt dan `jouwteam.cloudflareaccess.com`. **Noteer dat.**

**Access** → **Applications** → **Add an application** → **Self-hosted**:

| Veld | Waarde |
| --- | --- |
| Application name | `YOAssist` |
| Domain | `yoassist.pages.dev` (zonder `https://`) |
| Session duration | 24 hours |

**Next.** Bij het beleid:

- Action: **Allow**
- Include: **Emails** → plak de adressen van je Youth Officials en jezelf

**Next.** Identity provider: laat **One-time PIN** aanstaan. Opslaan.

Open de applicatie daarna opnieuw en kopieer de **Application Audience (AUD)
Tag** — een lange hexadecimale reeks.

---

## Stap 7 — De twee variabelen zetten

Pages → je project → **Settings** → **Variables and Secrets**.

Voor **Production** én **Preview**, telkens als gewone variabele (geen secret):

| Naam | Waarde |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | `jouwteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | de AUD-tag uit stap 6 |

**Belangrijk:** variabelen worden pas actief bij een nieuwe deploy. Ga naar
**Deployments**, open de laatste, en klik **Retry deployment**. Dit is de meest
voorkomende oorzaak van "ik heb het toch ingevuld".

---

## Stap 8 — Testen

Open je Pages-URL in een **privévenster**. Je krijgt het Access-scherm, vult je
adres in, plakt de code uit je mailbox.

Je hoort YOAssist te zien met rechtsboven je naam en drie puntjes. Zie je de
drie puntjes niet, dan staat `is_admin` niet op 1 voor jouw adres — terug naar
stap 2.

Klik op de drie puntjes, vul bij Clubs je club-GUID in (`BVBL` + vier cijfers)
en klik **Controleer**. Verschijnt de clubnaam met een aantal teams, dan werkt
de koppeling met Basketbal Vlaanderen.

Daarna: club toevoegen → **Teams laden** → de ploegen aanvinken → **Nu
synchroniseren**.

---

## Stap 9 — De cron-Worker

Dit is het enige stuk dat niet uit de Pages-repo komt: Pages Functions kunnen
geen uurwerk hebben, dus de automatische synchronisatie draait als aparte
Worker.

1. Dashboard → **Workers & Pages** → **Create** → **Workers** → **Create
   Worker**. Naam: `yoassist-cron`. **Deploy** (met de standaard voorbeeldcode).
2. **Edit code**. Wis alles in de editor.
3. Open `cron/worker-bundle.js`, kopieer de volledige inhoud, plak die in de
   editor. Dat is één bestand met alles erin — geen imports, geen tweede module.
4. **Deploy**.
5. Terug naar de Worker → **Settings** → **Bindings** → **Add** → **D1
   database**: variabelenaam `DB`, jouw yoassist-databank.
6. **Settings** → **Trigger Events** → **Add** → **Cron Trigger**:

   ```
   0 22,23,4,5,10,11,16,17 * * *
   ```

7. **Deploy** opnieuw, zodat de binding actief wordt.

Die acht uren staan in UTC. De Worker rekent zelf uit hoe laat het in Brussel
is en werkt alleen wanneer het daar 0, 6, 12 of 18 uur is. Zo klopt het zowel
in zomer- als in wintertijd, zonder dat je twee keer per jaar iets moet
aanpassen.

**Controle.** Wachten tot het volgende hele uur is saai. Je kunt ook gewoon in
het beheermenu op **Nu synchroniseren** klikken: dat draait exact dezelfde code
via Pages. Werkt dat, dan werkt de cron ook — de enige extra factor is de
binding, en die zie je meteen aan een foutmelding over `DB`.

Wil je de cron-Worker zelf uitlokken: **Settings** → **Variables** → **Add
secret** → naam `CRON_SECRET`, waarde naar keuze. Roep dan
`https://yoassist-cron.<jouw-subdomein>.workers.dev/?force=1` op met de header
`X-Cron-Secret`. Zonder die secret weigert de route.

---

## Wat je zonder terminal inlevert

Twee dingen, geen van beide blokkerend:

**Je kunt niet lokaal testen.** Elke wijziging test je op de echte site achter
Access. Voor een app van deze omvang is dat te doen, maar het maakt foutzoeken
trager.

**Je kunt de meegeleverde tests niet draaien.** Die 44 tests in `test/` hebben
Node nodig. Ze staan er voor het geval je later toch overstapt.

Wijzigingen aan de app doe je via github.com: blader naar het bestand, potlood
rechtsboven, aanpassen, **Commit changes**. Pages deployt automatisch. Wijzig je
`cron/worker-bundle.js`, dan moet je die apart opnieuw in de Worker-editor
plakken — die twee zijn niet aan elkaar gekoppeld.
