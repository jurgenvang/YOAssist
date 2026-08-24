# YOAssist

Beschikbaarheden en aanduidingen voor Youth Officials, gekoppeld aan de
wedstrijdkalender van Basketbal Vlaanderen.

## Wat er nu werkt

**Voor een Youth Official.** De thuiswedstrijden van de ploegen waarvoor hij is
aangeduid, gegroepeerd per maand en gesorteerd op datum, uur en ploeg. Per
wedstrijd twee knoppen: beschikbaar of niet beschikbaar. Nog niet geantwoord is
een derde toestand — geen van beide knoppen staat aan — met bovenaan een teller
van wat er nog open staat. Nog eens op dezelfde knop tikken wist het antwoord.

**Voor een beheerder.** Achter de drie puntjes rechtsboven, alleen zichtbaar en
alleen bereikbaar voor wie in de databank `is_admin = 1` heeft:

- Het seizoen, met een plus- en minknop. Een seizoen loopt van juli tot juni;
  het paneel toont wat de kalender zelf zegt zodat je ziet of je goed zit.
- Clubs toevoegen via hun GUID (`BVBL` + vier cijfers), met een controleknop die
  eerst de clubnaam en het aantal teams ophaalt. Pas daarna voeg je toe.
- De teams per club laden, gegroepeerd per club en op naam gesorteerd, met per
  ploeg een vinkje YO en YO+. YO aanvinken zet YO+ automatisch mee aan.
- Handmatig synchroniseren, met het resultaat van de laatste run.

**Automatisch.** Een aparte Worker synchroniseert om 6, 12, 18 en 24 uur
Belgische tijd. Nieuwe, gewijzigde en verdwenen wedstrijden komen in
`match_changes` terecht. Wat daarmee gebeurt, is nog niet ingevuld.

## Structuur

```
public/index.html              de volledige app (geen buildstap)
functions/api/_middleware.js   Access-verificatie, laadt de gebruiker
functions/api/admin/_middleware.js  adminafscherming voor alles onder /api/admin/
functions/api/me.js            GET  wie ben ik
functions/api/matches.js       GET  mijn wedstrijden
functions/api/availability.js  POST beschikbaarheid zetten of wissen
functions/api/admin/config.js      GET  alles voor het beheerscherm
functions/api/admin/season.js      POST seizoen wijzigen
functions/api/admin/resolve-club.js GET  GUID controleren bij Basketbal Vlaanderen
functions/api/admin/clubs.js       POST/PATCH/DELETE clubs
functions/api/admin/teams.js       POST teams laden, PATCH vlaggen zetten
functions/api/admin/sync.js        POST nu synchroniseren, GET logboek
functions/_lib/access.js       JWT-verificatie van Cloudflare Access
functions/_lib/vbl.js          client en parsers voor Basketbal Vlaanderen
functions/_lib/sync.js         de synchronisatielogica (gedeeld met de cron)
cron/index.js                  Worker met Cron Trigger
schema.sql / seed.sql          D1
test/                          44 tests, draaien zonder netwerk
```

## Opzetten

Volg `INSTALLATION.md` van het vorige project — de stappen zijn identiek, met
`yoassist` in plaats van `aanduidingen`. Daarna nog dit:

```bash
cd cron
npx wrangler deploy          # zet de cron-Worker online
```

De `database_id` in `cron/wrangler.toml` moet dezelfde zijn als die in de
hoofdmap. Beide praten met dezelfde databank.

Om een run uit te lokken zonder op de klok te wachten:

```bash
cd cron && npx wrangler secret put CRON_SECRET
curl -H "X-Cron-Secret: <je-secret>" "https://yoassist-cron.<subdomein>.workers.dev/?force=1"
```

## Testen

De testafhankelijkheden staan bewust in `test/`, niet in de hoofdmap. Een
`package.json` naast `public/` zou Cloudflare Pages bij elke deploy een
npm-installatie laten draaien voor een app die geen buildstap heeft — inclusief
het compileren van `better-sqlite3`, dat alleen de tests gebruiken.

```bash
cd test
npm install
npm test
```

De tests draaien tegen een echte SQLite-databank met een nagebootste API. Ze
dekken onder meer: uitwedstrijden negeren, seizoensfiltering, wijzigingen
detecteren en loggen, de drempel van drie verdwenen wedstrijden, een leeg of
mislukt antwoord dat niets mag wissen, en wie welke wedstrijden mag zien en
beantwoorden.

## Namen

`users` heeft `voornaam` en `achternaam` apart. Tussenvoegsels horen bij de
achternaam: `Van den Broeck` blijft één veld. Lijsten van officials sorteer je
op `achternaam, voornaam`; de weergavenaam wordt in de middleware samengesteld
zodat de frontend er niets van hoeft te weten.

## Twee dingen die nog geverifieerd moeten worden

De API was vanuit de ontwikkelomgeving niet bereikbaar, dus twee aannames staan
nog open:

1. **De vorm van `OrgDetailByGuid`.** De teamherkenning zoekt naar velden met
   `guid` in de naam waarvan de waarde met de club-GUID begint. Dat werkt voor
   drie plausibele structuren (getest), maar niet noodzakelijk voor de echte.
   Vindt de controleknop nul teams, roep dan
   `/api/admin/resolve-club?guid=BVBL....&diagnose=1` op: die geeft de ruwe
   structuur terug.

2. **Of de API meer dan één seizoen teruggeeft.** De filtering gebeurt op de
   seizoenscode in de wedstrijd-GUID, dus meerdere seizoenen naast elkaar is
   geen probleem. Geeft de API enkel het lopende seizoen, dan is de
   seizoensknop vooral een label en een veiligheid.

## Gebruiksvoorwaarden

De API-voorwaarden van Basketbal Vlaanderen beperken gebruik tot integraties op
websites van aangesloten clubs. Voor de eigen club zit je goed. Wordt dit iets
dat clubs buiten de jouwe bedient, contacteer dan eerst
info@basketbal.vlaanderen.

Het veld `wedOff` bevat namen van scheidsrechters. Die worden hier bewust niet
opgeslagen.
