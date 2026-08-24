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

**Voor een Youth Official.** De thuiswedstrijden van de ploegen waarvoor hij is
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
  ploeg een vinkje YO en YO+. YO aanvinken zet YO+ automatisch mee aan.
- Handmatig synchroniseren, met het resultaat van de laatste run.
- Gebruikersbeheer: toevoegen, activeren, deactiveren, met een kopieerklare
  adressenlijst voor de Access-policy. Een beheerder kan zichzelf niet
  degraderen of deactiveren, en de laatste actieve beheerder blijft beschermd.
- Cluboverzicht van de komende veertien dagen, met per wedstrijd de categorie,
  de scheidsrechters van Basketbal Vlaanderen, wie zich beschikbaar of niet
  beschikbaar zette, en een link naar het wedstrijdblad.

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
src/routes/gebruiker.js    /api/me, /api/clubs, /api/club, /api/matches,
                           /api/availability
src/routes/admin/index.js       seizoen, clubs, teams, sync
src/routes/admin/gebruikers.js  gebruikersbeheer
src/routes/admin/overzicht.js   cluboverzicht komende dagen
src/routes/admin/aanduiding.js  scope, toewijzen, vrijgeven, problemen
src/routes/admin/auto.js        automatische toewijzing
src/routes/admin/mail.js        mailconfiguratie en testmail
src/routes/admin/diagnose.js    ruwe API-respons bekijken
public/index.html          de app, geen buildstap
schema.sql / seed.sql      D1
test/                      411 tests, draaien zonder netwerk
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
