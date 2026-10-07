# YOAssist — projectcontext

Upload dit als **projectkennis**. Het bevat wat een volgend gesprek moet weten om
verder te kunnen zonder alles opnieuw uit te vragen.

Laatst bijgewerkt: v1.14.0

---

## Werkwijze bij een nieuwe versie

Er bestaat een skill, `yoassist-release`, die het volledige releaseproces
vastlegt: testsuite draaien, versienummer ophogen, schema herbouwen indien
nodig, de zip en delta-zip samenstellen, en de projectdocumenten
synchroniseren. Gebruik die bij het afronden van elke wijziging aan
YOAssist. Ze is als `.skill`-bestand aangemaakt (29 augustus 2026) — staat ze
niet in dit gesprek beschikbaar, dan is ze mogelijk nog niet toegevoegd aan
het Claude-project; `YOASSIST-INSTRUCTIES.md` beschrijft dezelfde stappen
zelfstandig als terugval.

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
| Broncode | GitHub — `github.com/jurgenvang/YOAssist`, automatisch gedeployd bij een push |

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

**Het detail per wedstrijd in de vergoedingen komt uit twee bronnen** (V36,
V37). Dat geldt voor Vergoedingen club, Mijn vergoeding en de maandmail; de
vertaling van `vergoeding_verwerkt` naar detailregels zit op één plek
(`verwerktAlsItems` in `vergoeding.js`), zodat de staat van de beheerder en het
scherm van de official nooit iets anders tonen.
Voor een open maand uit de huidige aanduidingen (`berekenMaand`); voor een
afgesloten maand uit `vergoeding_verwerkt`, nooit uit de huidige aanduidingen —
die kunnen sindsdien gewijzigd zijn, en de staat moet tonen wat er toen is
meegeteld. Een rij in `vergoeding_verwerkt` waarvan de wedstrijd buiten de
maand zelf valt, is een correctie. Weghalen uit het overzicht is gewoon een
vrijgave (`DELETE /api/admin/aanduiding`), geen aparte uitzondering in de
facturatie; daardoor kloppen cluboverzicht, Mijn vergoeding en logboek vanzelf
mee. Enkel bij een open maand, en enkel bij werk van die maand — niet bij een
correctie.

**Een aanduiding of vrijgave op een voorbije wedstrijd stuurt geen bericht.**
Het is een administratieve rechtzetting; de official verwittigen over een
wedstrijd die al gespeeld is, verwart alleen. Het logboek houdt ze wel bij.
`wijsToe` en `geefVrij` geven allebei `voorbij` terug. De botsingscontrole
blijft wel gelden, ook achteraf.

**Voorbije wedstrijden in het cluboverzicht enkel op vraag** (V35):
`/api/admin/overzicht?voorbij=1` begint bij de eerste dag van de vorige maand
(`beginVorigeMaand` in `venster.js`) — ver genoeg om een maand recht te zetten
vóór ze wordt afgesloten. Elke wedstrijd draagt `voorbij`; een voorbije telt
nooit mee in `inVenster` of `probleem`, zodat de cijfers bovenaan niet
verschuiven door de schakelaar. In de frontend een eigen groep *Voorbij*,
onderaan. Officials zien ze niet: `/api/matches` begint nog altijd bij vandaag.

**Een beheerder kan bevestigen dat er twee scheidsrechters zijn** terwijl het
systeem van de bond er nog geen toont (`refs_bevestigd`). Die vlag wijst niemand
aan en verandert niets aan hoeveel officials er nodig zijn; ze onderdrukt alleen
de melding. De sync wist ze zodra de bond zelf twee refs invult.

**De uitslag wordt automatisch opgehaald**, zodra Basketbal Vlaanderen ze
doorgeeft. Enkel ter info bij de wedstrijd, zit bewust niet in de
wijzigingshash — een binnenkomende uitslag zet een wedstrijd niet als
'gewijzigd' in het logboek. Twee VBL-valkuilen: `gespeeld` is `'G'`, niet het
voor de hand liggende `'J'`; `uitslag` komt met opvulspaties op wisselende
posities.

**Beheer is gesplitst in twee menu-items**, Dagelijks beheer en Configuratie.
Onder de motorkap blijft het één paneel met alle secties; elke sectie heeft een
`data-groep` en enkel de secties van de gekozen groep zijn zichtbaar. Geen
dubbele bindingscode, geen risico op stille null-fouten.

**Regio (V31)** toont wedstrijden bij externe, gevolgde clubs met nul of één
VBL-scheidsrechter, komende twee weekends, vanaf U14 (geen U10/U12). Een
aparte, lichte synchronisatie (`volgsync.js`), los van de hoofdcyclus, op cron
uur 5. Belangrijke les hierbij: enkel thuiswedstrijden meetellen — bij een
uitwedstrijd hoort `thuisGuid` bij de tegenstander, wat de categoriefilter
anders liet doorglippen. En: D1's honderd-parametergrens raakt snel bereikt bij
een lijst GUID's als filter; de opruiming gebruikt daarom een tijdstempel per
synchronisatieronde in plaats van een lijst sleutels.
Bij precies één scheidsrechter toont de pagina ook zijn naam.
Een knop bij Configuratie maakt de wedstrijdenlijst leeg zonder de gevolgde
clubs te raken.

**De backup dekt alle tabellen, en een test bewaakt dat.** Deze zin stond hier
al sinds v1.10, maar de code volgde niet: tot v1.14.0 zaten er maar 12 van de
21 tabellen in de backup — facturatie, berichten, ouder-kind en de
Regio-tabellen ontbraken — en de beloofde test bestond niet. Nu staan alle 22
tabellen in `TABELLEN` (`src/routes/admin/backup.js`), in de volgorde van
`schema.sql`, en `backup.test.mjs` leest de tabellen uit het schema en legt ze
ernaast.

**De woensdaglijst van de bond is de bron van de woensdagregel** (V39). Elke
woensdag rond 13:35 stuurt `info@basketbal.vlaanderen` een Mailchimp-
nieuwsbrief met een link naar een Excel (`mcusercontent.com/…/files/….xlsx`).
De Worker ontvangt mail via een `email()`-handler (Cloudflare Email Routing):
`src/lib/mime.js` leest de mail, `src/lib/xlsx.js` de Excel (zip + XML, zelf
geschreven, geen dependency), `src/lib/woensdaglijst.js` doet de rest.
Kernregels: (1) wat in de lijst staat, heeft 0 of 1 official — een cel die
anders gekleurd is dan de datumcel in dezelfde rij betekent 'aangeduid';
(2) wat er niet in staat, heeft er volgens de bond 2, ook als de API niemand
toont — dat gaat in `matches.bond_officials`, en `vblOfficials()` neemt het
hoogste van API en lijst; (3) koppelen op datum + uur + thuisploeg
(genormaliseerd), 'eigen' = de thuisploeg komt voor in onze wedstrijden;
(4) verwerken pas vanaf woensdag 14 uur Brussel; geen lijst om 14 uur =
waarschuwing, om 20 uur terugval op de API; een latere lijst zet alsnog recht;
(5) enkel wat automatisch in de lijst kwam (`scope_reden = 'woensdag'`) gaat er
weer uit, en nooit als er al iemand op staat. De lijst gebruikt dezelfde
`scope_reden` als de API-woensdagregel: een nieuwe waarde zou de CHECK
wijzigen, en dat vraagt een DROP van `matches`. Elke onverwachte vorm (afzender,
onderwerp, link, kolommen, datums) faalt luid naar de beheerders en wordt in
`vbl_lijsten` bewaard. De mailhandler gooit nooit: een geweigerde mail kaatst
terug naar de bond.

**Forfait is een eigen kolom, geen uitslag** (V40). De bond zet een forfait als
administratieve score met een code: `' 20-  0  BFOR'` (bezoekers) of
`'  0- 20  AFOR'` (thuisploeg), vaak al weken op voorhand. `normaliseerForfait`
leest dat naar `matches.forfait` ('thuis' / 'uit' / 'beide'); `uitslag` blijft
dan null. Een forfaitwedstrijd heeft geen officials nodig: woensdagregel,
herinneringen, automatisch aanvullen en 'vul nog in' slaan ze over, aanduiden
en beschikbaar zetten worden geweigerd, en in het cluboverzicht is `nodig` 0.
De synchronisatie meldt nieuwe forfaits (`rapport.nieuweForfaits`); wat er met
eigen aanduidingen gebeurt, zit in `src/lib/forfait.js` en hangt af van
`forfait_aanduiding`. **Automatisch vrijgeven enkel als het forfait vóór de
wedstrijddag gekend is** — op de dag zelf of achteraf kan de official al naar
de wedstrijd gekomen zijn, en dan beslist de beheerder bij de vergoedingen
(waar een forfait gemarkeerd staat maar gewoon meetelt). Forfaits in een al
afgesloten maand worden niet meer gemeld; voorbije forfaits komen niet in het
logboek — anders gaf de eerste synchronisatie na de invoering een vloed aan
'openstaande wijzigingen'.

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

**Berichten: een samenvatting voor de lijst, en de volledige tekst om te
openen.** `berichten` houdt bij wat er naar iemand ging — enkel bij succes;
mislukte pogingen horen in het logboek. `tekst` is één regel voor de lijst;
`volledig` (sinds v1.12.2, V38) is de tekst zoals verstuurd. Tot dan werd
bewust enkel een samenvatting bewaard, maar bij lange berichten (woensdagregel,
vergoeding, nieuws, welkom) bleef daardoor een afgebroken zin over zonder
manier om de rest te lezen. De oorspronkelijke reden blijft gedekt: de
wedstrijd wordt bij het opvragen opgehaald, niet meebewaard, zodat een
verplaatste wedstrijd de wedstrijdregel niet fout maakt; de volledige tekst
staat er expliciet als 'zoals verstuurd'. Berichten van vóór v1.12.2 hebben
`volledig = NULL` en krijgen geen 'lees meer'.

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
src/lib/forfait.js           eigen aanduidingen bij een nieuw forfait (V40)
src/lib/woensdaglijst.js     de woensdaglijst van de bond ontvangen en verwerken (V39)
src/lib/mime.js              een mail uitlezen, zonder bibliotheek
src/lib/xlsx.js              een Excel uitlezen (zip + XML, met celkleuren)
src/routes/admin/woensdaglijst.js  status van de ontvangen lijsten
src/lib/venster.js           weekendvenster van het cluboverzicht
src/lib/vergoeding.js        rekenregels facturatie, zuivere functies
src/lib/csv.js               CSV lezen en schrijven
src/lib/telefoon.js          nummers normaliseren, wa.me- en tel:-links
src/lib/namens.js            wie mag handelen namens wie (ouder-kind)
src/routes/extern.js         externe API + agendafeed, beide alleen-lezen
src/lib/volgsync.js          aparte synchronisatie voor Regio (V31), vanaf U14
src/routes/admin/aandacht.js Regio: gevolgde clubs, aandachtslijst, wis-knop
src/routes/admin/herinnering.js  handmatige herinnering wie nog niet invulde
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
test/                        1754 tests, draaien zonder netwerk
```

## Val­kuilen die al eens hebben toegeslagen

**`CREATE TABLE IF NOT EXISTS` voegt geen kolommen toe** aan een bestaande tabel,
en meldt niets. Elke schemawijziging vraagt een expliciete `DROP TABLE`.

**D1 staat honderd gebonden parameters per query toe.** `WHERE guid IN (?, ?, …)`
breekt zodra de kalender vol staat. De testomgeving dwingt die grens af.

**Een nieuwe waarde in een kolom met CHECK is een DROP.** `scope_reden` laat
enkel 'auto', 'admin' en 'woensdag' toe; een vierde waarde kan niet met ALTER
en zou `matches` (met aanduidingen en beschikbaarheden) laten droppen. Kijk
eerst of een bestaande waarde de lading dekt.

**Een parser die 'geen geldige waarde' geeft, kan informatie verbergen.**
`normaliseerUitslag` gaf terecht null bij `' 20-  0  BFOR'`, maar daarmee
verdween het forfait uit de app: een wedstrijd die niet doorging, zag eruit
als een die nog gespeeld moest worden. Kijk bij een onverwachte vorm wat ze
betekent, niet enkel of ze past.

**Een tekstvervanging die niets vindt, doet stilzwijgend niets.** Twee bugs
kwamen zo tot stand: een laadfunctie die nergens werd aangeroepen, en een
melding die nooit werd getoond. Altijd `assert t.count(oud) == 1`.

**Een substring matcht ook diepere inspringing.** `  const x` matcht ook
`    const x`. Vervang de meest ingesprongen variant eerst.

**Cloudflare stuurt nieuwe projecten naar Workers, niet naar Pages.** Het project
is als Worker aangemaakt; `npx wrangler deploy` is het juiste deploycommando.

**GitHub's uploadknop verliest de mapstructuur.** Navigeer eerst naar de doelmap,
of gebruik github.dev.

**Een vaste datum in een test is een tijdbom.** Zodra die datum voorbij is,
valt de testwedstrijd onder code die naar de echte datum van vandaag kijkt
(namen wissen na de wedstrijd, volgsync die gespeelde wedstrijden overslaat,
de avondcontrole) en faalt de test zonder dat er iets aan de app veranderde.
Gebeurde in oktober 2026 met vijf testbestanden tegelijk. Reken datums relatief
tegenover vandaag, behalve waar een test zelf een tijdstip simuleert en de code
dat tijdstip ook gebruikt.

**`better-sqlite3` kan niet native gebouwd worden in een Claude-sandbox.**
`node-gyp` heeft daarvoor de Node-headers van `nodejs.org` nodig; dat domein
zit niet in de toegelaten lijst. `cd test && npm test` faalt daardoor al bij
`npm install`, voor er één test draait. `test/frontend.test.mjs` heeft die
dependency niet (leest enkel `public/index.html` en `public/sw.js`) en kan wél
altijd rechtstreeks met `node test/frontend.test.mjs` — gebruik die als
deelverificatie bij een frontend-wijziging, en zeg er expliciet bij dat de
volle suite nog lokaal moet draaien vóór het naar GitHub gaat.

## Openstaand buiten de backlog

**De app is nog nooit met echte officials getest.** Alles is gebouwd op
specificaties en op één API-respons. Sinds domein en mail geregeld zijn, kan de
volledige keten draaien — dat testweekend is nu het enige wat er nog echt toe
doet.

Let op bij dat eerste gebruik: elke toewijzing stuurt meteen een mail naar de
betrokken official. Wie voorzichtig wil beginnen, zet eerst alleen zichzelf en
de tweede beheerder in de gebruikerslijst.
