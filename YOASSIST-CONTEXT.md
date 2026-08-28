# YOAssist — projectcontext

Upload dit als **projectkennis**. Het bevat wat een volgend gesprek moet weten om
verder te kunnen zonder alles opnieuw uit te vragen.

Laatst bijgewerkt: v1.8.0

---

## Wat het is

Een webapplicatie waarmee Youth Officials van AB InBev Leuven Bears hun
beschikbaarheid opgeven en beheerders hen aanduiden voor thuiswedstrijden. De
wedstrijdkalender komt van Basketbal Vlaanderen.

**Live:** `https://yoassist.org` (het oude adres
`https://yoassist.jurgenvang.workers.dev` blijft ook werken)

**Licentie:** EUPL v1.2. Zie `LICENSE`; de volledige tekst hoort er als
`LICENSE-NL.txt` naast, te downloaden bij de Europese Commissie.

## Techniek

Eén Cloudflare Worker met static assets. Geen buildstap, geen framework: de
volledige frontend is `public/index.html` met inline CSS en JavaScript.

| Onderdeel | Keuze |
|---|---|
| Runtime | Cloudflare Workers |
| Databank | D1 (SQLite), id `696c9518-702e-4e9f-9832-38c6bb10c6f6` |
| Authenticatie | Cloudflare Access, team `divine-leaf-1aba.cloudflareaccess.com` |
| Mail | Resend, afzenderdomein op `yoassist.org` geregeld |
| Aanmeldmethodes | Instelbaar (`aanmeld_methodes`); bepaalt enkel wat de welkomstmail vertelt |
| Broncode | GitHub, automatisch gedeployd bij een push |

**Secrets bij de Worker:** `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`,
`RESEND_API_KEY`, `VAPID_PUBLIEK`, `VAPID_PRIVE`, `VAPID_CONTACT`.
Niet in `wrangler.toml`: die worden bij elke deploy overschreven.

## Beslissingen die vastliggen

**Twee lagen authenticatie.** Cloudflare Access bepaalt wie binnen mag; de
`users`-tabel bepaalt wat hij mag. Wie in Access staat maar niet in `users`
krijgt 403. Beide lijsten moeten handmatig synchroon blijven; het beheerscherm
levert een kopieerklare adressenlijst.

**Aanduidingsscope zit op de wedstrijd, niet op de ploeg.** Drie wegen erin:
U10/U12 automatisch, een beheerder die ze aanduidt, of de woensdagregel (woensdag
14u: wedstrijden van het komende weekend met minder dan twee VBL-scheidsrechters).
Zet een beheerder een wedstrijd eruit, dan onthoudt `scope_uit` dat en haalt de
woensdagregel ze niet opnieuw binnen.

**Eén cron per uur.** `wrangler.toml` heeft `crons = ["0 * * * *"]`; de planner in
`src/index.js` beslist wat er op dat Brusselse uur moet gebeuren. Zeven taken over
zeven cron-expressies verdelen zou twee keer per jaar verschuiven met de zomertijd.

**Verdwenen wedstrijden worden gemarkeerd, nooit verwijderd** — er hangen
beschikbaarheden aan. Verdwijnen er meer dan drie tegelijk, dan gebeurt er niets
en krijgt de sync status `deels`.

**Facturatie werkt met momentopnames.** Een afgesloten maand ligt vast; wat er
nadien verandert komt als correctieregel in de volgende maand. Daarvoor bestaat
`vergoeding_verwerkt`, een spoor van wat er al is uitbetaald.

**Een beheerder kan bevestigen dat er twee scheidsrechters zijn** terwijl het
systeem van de bond er nog geen toont (`refs_bevestigd`). Die vlag wijst niemand
aan en verandert niets aan hoeveel officials er nodig zijn; ze onderdrukt alleen
de melding. De sync wist ze zodra de bond zelf twee refs invult.

**Twee beveiligingsmodellen voor lezen van buitenaf.** De JSON-API gebruikt een
sleutel in de `Authorization`-header (secret `EXTERN_API_SLEUTEL`); de
agendafeed een lange sleutel in de URL zelf, want een agenda-app kan geen header
meesturen. Beide slaan Cloudflare Access bewust over — daarvoor bestaat de
`publiek`-vlag op een route, plus een aparte prefix-check voor `/api/kalender/`
omdat dat pad dynamisch is. Alleen-lezen, geen enkel schrijfpad.

**De meldingenschakelaar meet het toestel, niet de databank.** `kanaal_push`
zegt enkel wat iemand ooit wilde; `pushManager.getSubscription()` zegt of dit
toestel werkelijk is ingeschreven. Die twee liepen uiteen, met een schakelaar
op 'aan' zonder manier om het alsnog in te stellen. De schakelaar toont nu het
echte abonnement en (de-)abonneert bij het omzetten.

**Berichten worden bewaard als samenvatting, niet als kopie.** `berichten` houdt
bij wat er naar iemand ging — enkel bij succes; mislukte pogingen horen in het
logboek. De wedstrijd wordt bij het opvragen opgehaald, niet meebewaard, zodat
een verplaatste wedstrijd het bericht niet fout maakt.

**Eén mededeling tegelijk.** `mededelingen` heeft één actieve rij met een
`geldig_tot`; wegklikken staat per persoon in `mededeling_gezien`. Verlopen geldt
voor iedereen, wegklikken enkel voor wie klikte.

**Een ouder kan invullen namens zijn kind.** Het kind is een gewone rij in
`users` met eigen beschikbaarheden, aanduidingen en vergoeding; `ouder_kind`
koppelt beide. Meerdere ouders per kind kan, ketens niet. Elk verzoek met
`namens` wordt tegen die tabel gecontroleerd — bestaat de koppeling niet, dan
volgt een 403 in plaats van stil terug te vallen op de eigen rij.

**Een gsm-nummer is zichtbaar voor wie samen fluit**, mits die persoon het deelt
(`gsm_delen`, standaard aan). Beheerders zien het altijd. Enkel bij wedstrijden
waar beiden op staan, niet clubbreed.

**De sectie-indeling van het aanduidingenscherm ligt vast per bezoek.** Antwoord
je op een wedstrijd, dan blijft de kaart staan waar hij stond; pas bij het
volgende bezoek verhuist hij. Anders springt de kaart die je net aantikte weg
onder je vingers.

**Alles wat over jou gaat, zit achter je naam.** Mijn vergoeding, Mijn
voorkeuren, Vergoedingen club, Beheer, Kijken als official, Over YOAssist. Dat
verving twee naamloze icoontjes waarvan je moest raden welk je nodig had.
De tabbladen zijn er alleen voor beheerders en per stuk uit te zetten.

**Kijken als official kan alleen wegnemen, nooit toevoegen.** De backend haalt
de identiteit uit Access; `?alsProfiel=YO` versmalt het resultaat en kan het
nooit verbreden. Zo is de schakelaar geen achterdeur.

**Handmatige wedstrijden hebben `bron = 'handmatig'`** en worden door de sync met
rust gelaten, anders zouden ze elke nacht als verdwenen gemarkeerd worden.

## De VBL-API

`http://vblcb.wisseq.eu/VBLCB_WebService/data` — ongedocumenteerd, HTTP.

- `OrgDetailByGuid?issguid=BVBL1125` → clubnaam, stamnummer, ploegen met
  `categorie` en `guid`
- `OrgMatchesByGuid?issguid=BVBL1125` → alle wedstrijden van de club

Ploeg-GUID: `BVBL1125J16  1` — club-GUID, drieletterige categoriecode, twee
spaties, volgnummer. De categoriecode is leidend, niet de teamnaam.

Wedstrijdvelden die ertoe doen: `guid` (bevat de seizoenscode op positie 5-8),
`tTGUID` (thuisploeg), `datumString` (`dd-mm-jjjj`), `beginTijd` (`10.30`),
`accGUID` en `accNaam` (locatie), `wedOff` (array met namen van aangeduide
scheidsrechters).

Wedstrijdblad: `https://vblweb.wisseq.eu/Home/MatchDetail?wedguid={guid}`

**De API is niet bereikbaar vanuit de ontwikkelomgeving** (geen toegang tot dat
domein). Gebruik `/api/admin/diagnose-matches` om een echte respons te bekijken.

## Categorieën

| Codes | Groep | Tarief | Scope |
|---|---|---|---|
| G10, G12, M12 | U10U12 | € 15 | automatisch |
| G14, M14 | U14 | € 20 | via admin of woensdagregel |
| J16, M16 | U16 | € 20 | idem |
| J18 | U18 | € 20 | idem |
| M19 | U19 | € 20 | idem |
| J21 | U21 | € 20 | idem |
| HSE, DSE | SEN | € 25 | idem |

`G08` en `ROL` bestaan bij de club maar staan bewust niet in de tabel. Ploegen
met een onbekende categorie starten op niet-volgen, en afsluiten wordt geweigerd
zolang er aanduidingen op staan.

## Regels rond aanduidingen

Twee officials per wedstrijd, min wat de bond al heeft aangeduid. Botsingen
worden gemeten van aanvang tot aanvang: twee uur in dezelfde zaal (vergeleken op
`accGUID`), tweeënhalf uur bij een andere. Officials worden twintig minuten voor
aanvang verwacht; dat telt alleen in de herinneringen, niet in de conflictcontrole.

Een aangeduide official kan zijn beschikbaarheid niet meer wijzigen, wel een
probleem melden.

## Bestandsindeling

```
src/index.js                 routetabel, authenticatie, cron-planner
src/versie.js                het versienummer, één plaats
src/lib/access.js            identiteit uit Access (ctx.access of JWT)
src/lib/vbl.js               client en parsers voor Basketbal Vlaanderen
src/lib/sync.js              synchronisatielogica
src/lib/aanduiding.js        hoeveel nodig, botsingen, opkomsttijd
src/lib/autotoewijzing.js    planningsalgoritme, zuivere functie
src/lib/woensdag.js          woensdagregel en avondcontrole
src/lib/venster.js           weekendvenster van het cluboverzicht
src/lib/vergoeding.js        rekenregels facturatie, zuivere functies
src/lib/csv.js               CSV lezen en schrijven
src/lib/telefoon.js          nummers normaliseren, wa.me- en tel:-links
src/lib/namens.js            wie mag handelen namens wie (ouder-kind)
src/routes/extern.js         externe API + agendafeed, beide alleen-lezen
src/lib/logboek.js           vorm van een logregel
src/lib/mailer.js            versturen via Resend, templates, zandbakgrens
src/lib/push.js              Web Push: VAPID-JWT en aes128gcm met WebCrypto
src/lib/verwittigen.js       één kanaal per persoon, volgens voorkeuren
src/lib/http.js              json-, fout- en leeshulpjes
src/routes/                  gebruiker, voorkeuren, vergoeding, admin/*
public/index.html            de volledige app
public/sw.js                 service worker voor meldingen
public/rondleiding.js        twee rondleidingen, apart voor de test
public/handleiding.html      de handleiding als pagina in de app
public/manifest.json         PWA-manifest voor 'Zet op beginscherm'
public/icoon/                het app-icoon in alle formaten
LICENSE                      EUPL v1.2
schema.sql                   de bron van waarheid voor de databank
schema-console.sql           opgedeeld in blokken voor de D1-console
schema-alles-in-een.sql      drops plus schema, in één keer uitvoerbaar
test/                        1289 tests, draaien zonder netwerk
```

## Val­kuilen die al eens hebben toegeslagen

**`CREATE TABLE IF NOT EXISTS` voegt geen kolommen toe** aan een bestaande tabel,
en meldt niets. Elke schemawijziging vraagt een expliciete `DROP TABLE`.

**D1 staat honderd gebonden parameters per query toe.** `WHERE guid IN (?, ?, …)`
breekt zodra de kalender vol staat. De testomgeving dwingt die grens af.

**Een tekstvervanging die niets vindt, doet stilzwijgend niets.** Twee bugs
kwamen zo tot stand: een laadfunctie die nergens werd aangeroepen, en een
melding die nooit werd getoond. Altijd `assert t.count(oud) == 1`.

**Een substring matcht ook diepere inspringing.** `  const x` matcht ook
`    const x`. Vervang de meest ingesprongen variant eerst.

**Cloudflare stuurt nieuwe projecten naar Workers, niet naar Pages.** Het project
is als Worker aangemaakt; `npx wrangler deploy` is het juiste deploycommando.

**GitHub's uploadknop verliest de mapstructuur.** Navigeer eerst naar de doelmap,
of gebruik github.dev.

## Openstaand buiten de backlog

**De app is nog nooit met echte officials getest.** Alles is gebouwd op
specificaties en op één API-respons. Sinds domein en mail geregeld zijn, kan de
volledige keten draaien — dat testweekend is nu het enige wat er nog echt toe
doet.

Let op bij dat eerste gebruik: elke toewijzing stuurt meteen een mail naar de
betrokken official. Wie voorzichtig wil beginnen, zet eerst alleen zichzelf en
de tweede beheerder in de gebruikerslijst.
