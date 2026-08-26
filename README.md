# YOAssist

Beschikbaarheden en aanduidingen voor Youth Officials, gekoppeld aan de
wedstrijdkalender van Basketbal Vlaanderen.

Draait als één Cloudflare Worker met static assets: de app, de API en de
geplande synchronisatie zitten in hetzelfde project.

## Wat er werkt

**Clubkoppeling.** Is er precies één club geconfigureerd, dan wordt een
gebruiker daar stilzwijgend aan gekoppeld. Zijn er meerdere, dan kiest hij zelf
uit een lijst met de clubnamen erbij. Alleen actieve, geconfigureerde clubs zijn
kiesbaar — anders zou iemand zich aan een willekeurige GUID kunnen hangen.

**Versienummer.** Staat in `src/versie.js` en komt via `/api/me` in de balk
naast de naam YOAssist. Beheerders zien het ook onder hun eigen naam, want dat
is de plek waar je kijkt als iemand een probleem meldt. Verhoog het bij elke
deploy die het gedrag verandert.

**Voor een Youth Official.** Het tabblad heet Aanduidingen en heeft drie
secties, in volgorde van wat er van je verwacht wordt: eerst waarvoor je bent
aangeduid, dan wat nog een antwoord vraagt, en onderaan wat je al beantwoord
hebt. Bij elke
wedstrijd staat wie er al op staat: de scheidsrechters die Basketbal Vlaanderen
aanduidde, de aangeduide officials van de eigen club met de eigen naam
gemarkeerd, en hoeveel er nog gezocht worden. Ook zichtbaar bij wedstrijden waar
de gebruiker zelf niets mee te maken heeft — je wil weten met wie je aan de
tafel staat en of er nog plaats is.

De thuiswedstrijden van de ploegen waarvoor hij is
aangeduid, gegroepeerd per maand en gesorteerd op datum, uur en ploeg. Per
wedstrijd twee knoppen: beschikbaar of niet beschikbaar. Nog niet geantwoord is
een derde toestand — geen van beide knoppen staat aan — met bovenaan een teller
van wat er nog open staat. Nog eens op dezelfde knop tikken wist het antwoord.

**Voor een beheerder.** Achter de drie puntjes rechtsboven, alleen zichtbaar
voor wie `is_admin = 1` heeft, en alleen bereikbaar voor wie dat ook echt is:

- Het seizoen, met plus- en minknop. Een seizoen loopt van juli tot juni; het
  paneel toont wat de kalender zelf zegt zodat je ziet of je goed zit.
- Clubs toevoegen via hun GUID (`BVBL` + vier cijfers), met een controleknop die
  eerst de clubnaam en het aantal teams ophaalt.
- De teams per club laden, gegroepeerd per club en op naam gesorteerd, met per
  ploeg een vinkje 'volgen'. Twee knoppen zetten alles tegelijk aan of uit.
  Een nieuwe ploeg met een onbekende categorie (ROL, G08, ...) start op
  niet-volgen: een waarschuwing tonen én het vinkje intussen aanzetten zou
  betekenen dat er gesynchroniseerd wordt voor een ploeg zonder tarief zonder
  dat iemand er bewust ja tegen zei. 'Alles volgen' slaat die ploegen om
  dezelfde reden over en meldt hoeveel.
- Handmatig synchroniseren, met het resultaat van de laatste run.
- Gebruikersbeheer, gesplitst in Beheerders / YO+ / YO. Toevoegen, activeren,
  deactiveren, verwijderen, met een kopieerklare adressenlijst voor de
  Access-policy. Een beheerder kan zichzelf niet degraderen of deactiveren, en
  de laatste actieve beheerder blijft beschermd. Verwijderen kan alleen bij wie
  nog niets heeft ingevuld; voor de rest is deactiveren de juiste actie.
- Bulk toevoegen via CSV, met een downloadbaar sjabloon. De import is standaard
  een droogloop: eerst tonen wat er zou gebeuren, pas na bevestiging
  wegschrijven. Fouten worden per regel gemeld met het regelnummer erbij en
  blokkeren de rest niet. De lezer verwerkt puntkomma's, BOM's, Windows-
  regeleindes en aanhalingstekens — de eigenaardigheden van een Excel-export.
- Cluboverzicht over de twee eerstvolgende volledige weekends. Basketbal draait
  op weekends, dus een venster in dagen zou een zaterdag van haar zondag kunnen
  afknippen; `venster.js` rekent daarom in weekends. Wat later komt, staat
  achter een 'toon meer'.
  Wedstrijden staan gegroepeerd: eerst U10/U12, dan de rest. Per wedstrijd de
  categorie, de scheidsrechters van Basketbal Vlaanderen, wie zich beschikbaar
  of niet beschikbaar zette, de eigen aanduidingen, en een link naar het
  wedstrijdblad. Wedstrijden in het venster die onvolledig zijn aangeduid of
  waarvoor niemand beschikbaar is, staan in het rood.
  De vier tellers bovenaan zijn tegelijk filters; ze gelden altijd over de twee
  weekends, ook als de lijst verder is opengeklapt.

**De aanduidingslijst.** Of een wedstrijd erin staat, wordt per wedstrijd
beslist, niet per ploeg. Drie wegen: U10/U12 komt er automatisch in, een
beheerder kan er een in zetten, en de woensdagregel zet er de wedstrijden van
het komende weekend in waar Basketbal Vlaanderen minder dan twee scheidsrechters
op heeft staan. Zet een beheerder er een uit, dan haalt de woensdagregel ze niet
opnieuw binnen.

**Toewijzen.** Twee officials per wedstrijd, min wat de bond al heeft aangeduid.
De beheerder wijst toe vanuit het cluboverzicht: klik op een beschikbare naam.
Botsingen worden gemeld met vermelding van de andere wedstrijd — twee uur tussen
aanvangsuren in dezelfde zaal, tweeënhalf bij een verplaatsing — en kunnen
overruled worden. Vrijgeven dekt zowel intrekken als weigeren.

Een official die is aangeduid kan zijn beschikbaarheid niet meer wijzigen, maar
wel een probleem melden. Dat komt bij de beheerder terecht.

**Automatisch aanvullen.** Een knop in het cluboverzicht berekent een voorstel
en toont het eerst; pas na bevestiging wordt er iets weggeschreven. Het
algoritme verdeelt zo gelijk mogelijk over het seizoen, behandelt schaarse
wedstrijden eerst, vermijdt botsingen, en laat bestaande aanduidingen ongemoeid.
Wat niet ingevuld raakt, wordt met reden gemeld.

Het planningsalgoritme is een zuivere functie: geen databank, geen klok, geen
toeval. Dezelfde invoer geeft altijd hetzelfde resultaat, en daarom toont de
droogloop exact wat er zal gebeuren.

**Mail.** Afzenderadres instelbaar in het beheerscherm, API-sleutel als secret
bij de Worker. De testmodus van Resend (`onboarding@resend.dev`) werkt zonder
eigen domein maar levert enkel af bij het adres van het Resend-account; `verstuur()`
in `mailer.js` dwingt die grens op één plaats af, zodat geen enkele toekomstige
aanroeper ze kan vergeten.

Zodra afzender en sleutel allebei ingesteld zijn:
- een official krijgt mail bij een aanduiding of een vrijgave
- YO+'ers krijgen mail wanneer de woensdagregel wedstrijden toevoegt
- beheerders krijgen mail bij een gemeld probleem, bij de avondcontrole (als
  een wedstrijd via de woensdagregel toch een VBL-scheidsrechter kreeg), en
  op maandagochtend een overzicht van de open wedstrijden voor het weekend,
  gesplitst in U10/U12 en de rest

Mail versturen kan de eigenlijke actie (toewijzen, vrijgeven, een probleem
melden) nooit laten mislukken — lukt het versturen niet, dan gaat de actie
gewoon door en meldt de respons dat er geen mail is gegaan.

**Rondleiding.** Wijst de echte knoppen aan met een gat in een donkere laag,
in plaats van ze na te tekenen. Verschijnt eenmalig bij de eerste aanmelding en
is daarna oproepbaar via Mijn voorkeuren. Beheerders krijgen drie stappen extra.

De stappen staan in `public/rondleiding.js`, los van de weergavecode. Dat is
geen ordelijkheid maar noodzaak: zo kan een test controleren dat elk doelelement
ook echt in de interface bestaat. Verhuist er ooit een knop, dan valt de test om
in plaats van dat er stil een pijl naar het luchtledige wijst. Stappen die naar
een onzichtbaar element wijzen — een beheerdersknop bij een gewone YO, of een
wedstrijdkaart in een lege lijst — worden overgeslagen.

**Het naammenu.** Alles wat over jou gaat zit achter je naam rechtsboven:
Mijn voorkeuren, de rondleiding, en voor beheerders ook Beheer. Daarvoor stonden
er twee naamloze icoontjes naast elkaar waarvan je moest raden welk je nodig had.
Je eigen naam is de plek waar mensen hun eigen dingen verwachten, en het menu
groeit mee als er later iets bijkomt.

**Mijn voorkeuren.** Zichtbaar voor iedereen —
ook voor een gewone Youth Official. Mail aan of uit, meldingen aan of uit, en de
twee herinneringen (de avond ervoor, de ochtend zelf). Bewust gescheiden van het
beheerpaneel: dit gaat over hoe iemand zelf verwittigd wil worden, niet over de
club. Een beheerder die ook YO+ is, ziet beide knoppen naast elkaar.

Alle berichten gaan door `verwittigen.js`, dat per ontvanger de voorkeuren
toepast. Geen enkele route stuurt nog rechtstreeks mail of push: zo kan een
nieuwe aanroeper de voorkeuren niet vergeten.

**Push.** Web Push werkt niet met bestaande bibliotheken in een Worker, dus
`push.js` doet het zelf met WebCrypto: een VAPID-JWT met ECDSA P-256, en de
inhoud versleuteld volgens aes128gcm. Dat laatste is geen luxe — een pushbericht
zonder correcte versleuteling wordt door de browser weggegooid zonder
foutmelding.

Verlopen abonnementen (status 404 of 410) worden meteen opgeruimd. Mail blijft
het betrouwbare kanaal: op iPhone werkt push alleen als de gebruiker de site aan
zijn beginscherm heeft toegevoegd, en dat is een Apple-beperking die niet te
omzeilen is.

Sleutels aanmaken: `cd test && node maak-vapid.mjs`. De private sleutel hoort
als secret bij de Worker, samen met `VAPID_PUBLIEK` en `VAPID_CONTACT`.

**Facturatie.** Tarieven per categorie staan in `categorieen`. Een maand kan
afgesloten worden vanaf de eerste dag van de volgende maand; dat legt de
bedragen vast in een momentopname. Elke official krijgt zijn eigen overzicht per
mail, en een instelbare lijst adressen krijgt de verzamelstaat — de
penningmeester hoeft geen beheerder te zijn.

Wat er ná een afsluiting nog verandert, raakt het bedrag van toen niet meer maar
komt als correctieregel in de eerstvolgende afsluiting: `Correctie 2026-09: −1 ×
U12`. Daarvoor bestaat `vergoeding_verwerkt`, een spoor van wat er al is
uitbetaald. Zonder dat spoor kun je niet weten of een ontbrekende aanduiding
nooit is meegeteld of net wel.

Afsluiten wordt geweigerd zolang er aanduidingen op een categorie zonder tarief
staan. Op nul zetten zou stil verkeerd zijn. Wedstrijden die uit de kalender
verdwenen tellen niet automatisch mee, maar worden apart getoond zodat een
beheerder kan oordelen.

Officials zien hun overzicht in het tabblad Vergoeding, recentste maand bovenaan.
De lopende maand staat er ook bij met de vermelding dat er nog niets vastligt —
zonder die regel komt de vraag 'ik heb vorige week gefloten, waarom staat er
niets' bij de beheerder terecht.

**Backup.** Eén JSON-bestand met alles erin, ook de wedstrijden. Die zijn
weliswaar opnieuw op te halen bij Basketbal Vlaanderen, maar niet zoals ze er
vorig seizoen bij stonden — en juist dat wil je in een backup terugvinden.

In het bestand staan de schemaversie, het tijdstip, wie het maakte, en het
aantal rijen per tabel. Een backup zonder die vier is over twee jaar een
raadsel, en een bestandsnaam overleeft de eerste keer doorsturen niet. Er staat
ook een `volgorde`-veld in: de tabellen in de volgorde waarin ze bij een herstel
ingelezen moeten worden, ouders vóór kinderen.

Terugzetten is bewust niet gebouwd. Dat is de gevaarlijke helft: één verkeerde
klik overschrijft een heel seizoen. Wie moet herstellen, doet dat via de
D1-console met dit bestand in de hand.

**Opnieuw beginnen.** Vier niveaus, oplopend ingrijpend: enkel wedstrijden,
ploegen erbij, alles behalve gebruikers, of volledig opnieuw. Wat elk niveau
wist staat op één plaats in `reset.js`, met de huidige aantallen erbij in de
interface — '412 rijen' laat een beheerder aarzelen op precies het juiste moment.

De twee zwaarste niveaus vragen dat de clubnaam wordt overgetypt. Bij 'volledig
opnieuw' blijft het eigen account bewaard, zodat de beheerder zichzelf niet
buitensluit. Categorieën en tarieven blijven altijd staan: dat zijn geen
clubgegevens.

Een reset kan niet doorgaan zolang er afgesloten maanden bestaan voor
facturatie. Die controle zit er nu al in, hoewel de facturatiemodule nog niet
bestaat — achteraf toevoegen zou betekenen dat er een venster is waarin het wél
kon.

**Logboek.** Eén chronologisch spoor van alles wat er gebeurt, in drie
categorieën: wedstrijden (synchronisatie, handmatige toevoegingen), aanduidingen
(toewijzen, vrijgeven, probleemmeldingen) en beheer (club, teams, seizoen,
bulkacties). Filterbaar op categorie, periode en zoekterm, met de mogelijkheid
om regels af te vinken.

Bewust één tabel en geen aparte per onderwerp: een beheerder die zich afvraagt
waarom een wedstrijd er anders bij staat, wil in één lijst zien dat de
synchronisatie het uur wijzigde én dat iemand daarna de aanduiding vrijgaf.
Loggen faalt stil — een kapotte logregel mag de actie zelf nooit breken, en daar
staat een test op.

**Vrijgeven in bulk.** Per maand of voor het hele seizoen, apart voor
aanduidingen en beschikbaarheden of allebei tegelijk. Standaard een droogloop:
je ziet eerst hoeveel er geraakt wordt en wie, pas na bevestiging gebeurt er
iets.

Het onderscheid tussen de twee is opzettelijk. Een aanduiding gaat op
'vrijgegeven' en blijft bestaan, zodat achteraf zichtbaar is dat er iets is
teruggedraaid. Een beschikbaarheid kent die tussentoestand niet — geen rij
betekent 'nog niet geantwoord' — dus daar is vrijgeven de rij wissen.

De betrokken officials krijgen geen bericht: bij dertig aanduidingen tegelijk
zou dat dertig mails betekenen voor wat meestal een opruimactie is. De
beheerders krijgen wel één overzichtsmail, en de actie komt in het logboek.

**Eigen wedstrijden.** Wat niet in de kalender van Basketbal Vlaanderen staat —
oefenwedstrijden, toernooien — kan handmatig of via CSV toegevoegd worden. Die
krijgen `bron = 'handmatig'` en worden door de synchronisatie met rust gelaten;
anders zouden ze elke nacht als verdwenen gemarkeerd worden omdat de API ze niet
kent.

Een bestaande wedstrijd wordt nooit stilzwijgend overschreven. Zonder een
expliciete `overwrite`-vlag wordt de rij geweigerd en gemeld, met vermelding of
ze van Basketbal Vlaanderen komt. Overschrijven raakt bovendien alleen de
wedstrijdgegevens aan: beschikbaarheden en aanduidingen blijven staan, want die
horen bij de wedstrijd en niet bij de rij waarmee ze werd aangemaakt.

**Automatisch.** Eén cron per uur, met een planner die beslist wat er in Brussel
op dat moment moet gebeuren: synchroniseren om 0, 6, 12 en 18 uur, de
woensdagregel op woensdag om 14 uur, en een controle elke avond om 20 uur.
Zomer- en wintertijd komen zo vanzelf goed.

## Structuur

```
src/index.js               entrypoint: routetabel, authenticatie, cron
src/versie.js              het versienummer, één plaats
src/lib/access.js          identiteit uit Access (ctx.access of JWT)
src/lib/http.js            json-, fout- en leeshulpjes
src/lib/vbl.js             client en parsers voor Basketbal Vlaanderen
src/lib/sync.js            synchronisatielogica
src/lib/aanduiding.js      rekenregels: hoeveel nodig, botsingen, opkomsttijd
src/lib/woensdag.js        de woensdagregel en de avondcontrole
src/lib/autotoewijzing.js  het planningsalgoritme, zuivere functie
src/lib/mailer.js          versturen, templates, de zandbakgrens
src/lib/venster.js         het weekendvenster van het cluboverzicht
src/lib/csv.js             CSV lezen en schrijven, zuivere functies
src/lib/logboek.js         één plaats waar een logregel vorm krijgt
src/lib/push.js            Web Push: VAPID-JWT en aes128gcm met WebCrypto
src/lib/verwittigen.js     één kanaal per persoon, volgens zijn voorkeuren
src/routes/gebruiker.js    /api/me, /api/clubs, /api/club, /api/matches,
                           /api/availability
src/routes/voorkeuren.js   persoonlijke voorkeuren en push-abonnementen
public/sw.js               service worker: meldingen tonen en openen
public/rondleiding.js      de stappen van de rondleiding, los van de weergave
src/routes/admin/index.js       seizoen, clubs, teams, sync
src/routes/admin/gebruikers.js  gebruikersbeheer
src/routes/admin/overzicht.js   cluboverzicht komende dagen
src/routes/admin/aanduiding.js  scope, toewijzen, vrijgeven, problemen
src/routes/admin/auto.js        automatische toewijzing
src/routes/admin/wedstrijden.js eigen wedstrijden toevoegen en importeren
src/routes/admin/vrijgeven.js   aanduidingen en beschikbaarheden in bulk
src/routes/admin/logboek.js     het logboek bekijken en afvinken
src/routes/admin/reset.js       opnieuw beginnen, per onderdeel
src/routes/admin/backup.js      volledige momentopname als JSON
src/routes/admin/facturatie.js  maand afsluiten, verzamelstaten
src/routes/vergoeding.js        het eigen overzicht van een official
src/lib/vergoeding.js           rekenregels, zuivere functies
src/routes/admin/mail.js        mailconfiguratie en testmail
src/routes/admin/diagnose.js    ruwe API-respons bekijken
public/index.html          de app, geen buildstap
schema.sql / seed.sql      D1
test/                      976 tests, draaien zonder netwerk
```

Er staat bewust **geen `package.json` in de hoofdmap**. De build zou er anders
een npm-installatie op loslaten voor een app die niets te bouwen heeft. De
testafhankelijkheden staan in `test/`.

## Authenticatie: twee wegen

1. **Access voor Workers.** De policy hangt aan de Worker zelf en dekt ook
   workers.dev en preview-URL's. De identiteit komt binnen via `ctx.access`;
   geen JWT-werk nodig.

2. **Terugval op JWT-verificatie.** Een Worker met static assets draait achter
   een interne router, en die geeft `ctx.access` niet door. Access beschermt de
   app dan nog steeds, maar de code controleert het token zelf. Daarvoor moeten
   `CF_ACCESS_TEAM_DOMAIN` en `CF_ACCESS_AUD` ingevuld zijn in `wrangler.toml`.

De code probeert weg 1 en valt terug op weg 2. Vul die twee variabelen dus in,
ook als je denkt dat `ctx.access` beschikbaar is — kost niets en voorkomt een
lastig te plaatsen 401.

**Verlopen aanmelding.** Access-sessies verlopen. De pagina is dan al geladen,
dus een API-aanroep geeft 401 terug en de gebruiker zou een foutmelding zien in
plaats van het loginscherm. `api()` herlaadt in dat geval de pagina, waarna
Access het verzoek onderschept en zelf om aanmelding vraagt.

Daar zit een rem op: hoogstens één herlaadbeurt per twintig seconden, bewaard in
sessionStorage. Een 401 kan namelijk ook een andere oorzaak hebben — een
ontbrekende `CF_ACCESS_AUD` bijvoorbeeld — en zonder rem zou de pagina dan
eindeloos blijven tollen. Werkt sessionStorage niet, dan wordt er niet
automatisch herladen: geen rem betekent liever geen automatisme.

Zet de sessieduur in Zero Trust op 24 uur. Korter kost je officials telkens een
nieuwe PIN-mail zonder dat het iets beschermt wat het beschermen waard is.

De aud-controle in weg 2 is niet optioneel: zonder die vergelijking zou een
geldig token van gelijk welke andere Access-applicatie hier ook werken.

## Opzetten

Zie `INSTALLATIE.md`.

## Testen

```bash
cd test
npm install
npm test
```

De tests draaien tegen een echte SQLite-databank met een nagebootste API en een
nagebootste `ctx`. Ze dekken onder meer: routering en methodecontrole, alle
authenticatiepaden, de adminafscherming per route, het feit dat de gebruiker
nooit uit de request body komt, de zichtbaarheidsregels per profiel en club,
wijzigingsdetectie, de drempel van drie verdwenen wedstrijden, een leeg of
mislukt API-antwoord dat niets mag wissen, en of de cron in zomer- én wintertijd
op de juiste Brusselse uren draait.

## Twee dingen die nog geverifieerd moeten worden

De API was vanuit de ontwikkelomgeving niet bereikbaar, dus twee aannames staan
open:

1. **De vorm van `OrgDetailByGuid`.** De teamherkenning zoekt naar velden met
   `guid` in de naam waarvan de waarde met de club-GUID begint. Dat werkt voor
   drie plausibele structuren (getest), maar niet noodzakelijk voor de echte.
   Vindt de controleknop nul teams, roep dan
   `/api/admin/resolve-club?guid=BVBL....&diagnose=1` op.

2. **Of de API meer dan één seizoen teruggeeft.** De filtering gebeurt op de
   seizoenscode in de wedstrijd-GUID, dus meerdere seizoenen naast elkaar is
   geen probleem. Geeft de API enkel het lopende seizoen, dan is de
   seizoensknop vooral een label en een veiligheid.

## Namen

`users` heeft `voornaam` en `achternaam` apart. Tussenvoegsels horen bij de
achternaam: `van Geijstelen` blijft één veld. Sorteren gebeurt op
`achternaam COLLATE NOCASE, voornaam COLLATE NOCASE` — zonder die vermelding
sorteert SQLite op bytewaarde en komt `Van Meerbeeck` vóór `van Geijstelen`.

## Gebruiksvoorwaarden

De API-voorwaarden van Basketbal Vlaanderen beperken gebruik tot integraties op
websites van aangesloten clubs. Voor de eigen club zit je goed. Bedient dit
later clubs buiten de jouwe, contacteer dan eerst info@basketbal.vlaanderen.

Het veld `wedOff` bevat namen van scheidsrechters. Die worden hier bewust niet
opgeslagen.


## Samenvouwen

Secties zijn samenvouwbaar op de drie plaatsen waar er meerdere onder elkaar
staan: de aanduidingenlijst, het cluboverzicht en het beheerpaneel. Eén
mechanisme, `koppelVouwknoppen()`, bedient twee vormen: een kop met een
bijhorende inhoudscontainer, of een `h3` in een `.blok` waar de rest van het
blok de inhoud is.

De kop is zelf de knop. Een apart pijltje aanklikken is op een telefoon te fijn
mikwerk. De stand wordt per sectie onthouden in localStorage, zodat een
beheerder die het halve paneel dichtklapt dat niet elke keer opnieuw moet doen.

## Grenzen van D1

D1 laat maximaal honderd gebonden parameters per query toe. Een query die één
parameter per wedstrijd bindt — bijvoorbeeld `WHERE guid IN (?, ?, ?, ...)` —
breekt dus zodra de kalender vol staat. Dat is één keer gebeurd, toen het
cluboverzicht van veertien naar zestig dagen ging.

De testomgeving dwingt diezelfde grens af, zodat zo'n query hier faalt in plaats
van pas in productie. Filter daarom altijd op de voorwaarden zelf en niet op een
lijst sleutels.
