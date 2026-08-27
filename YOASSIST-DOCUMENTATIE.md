# YOAssist — hoe het werkt

Versie 1.0.0

Dit document legt uit wat YOAssist doet, waar het draait en wat er nodig is om
het draaiende te houden. Bedoeld voor wie de app beheert, en voor wie hem ooit
overneemt.

---

## 1. Waarvoor het dient

Bij thuiswedstrijden van de jeugd moet een basketbalclub zelf voor
scheidsrechters zorgen. Youth Officials zijn jonge leden die die wedstrijden
fluiten. Wie kan wanneer, wie is al ergens anders bezig, en wie heeft er al
genoeg gedaan dit seizoen — dat werd bijgehouden in berichten en lijstjes.

YOAssist doet drie dingen:

1. **De kalender ophalen** bij Basketbal Vlaanderen, automatisch, vier keer per
   dag.
2. **Beschikbaarheden verzamelen** bij de Youth Officials.
3. **Aanduidingen maken** door een beheerder, met controle op botsingen, en
   iedereen daarover verwittigen.

Daarnaast houdt het de vergoedingen bij en sluit het per maand af.

---

## 2. Wie ziet wat

Er zijn drie rollen. Ze staan in de `users`-tabel en worden door een beheerder
toegekend.

| Rol | Ziet |
|---|---|
| **YO** | Alleen U10- en U12-wedstrijden |
| **YO+** | Alle wedstrijden die in de aanduidingslijst staan |
| **Beheerder** | Alles, plus het cluboverzicht, het logboek en het beheerpaneel |

Een beheerder is meestal ook YO+. Hij kan met **Kijken als official** tijdelijk
zien wat een gewone YO ziet, om te controleren of het klopt.

**Wat waar staat.** Officials hebben één scherm: Aanduidingen. Beheerders hebben
daarnaast tabbladen voor Cluboverzicht en Logboek, die ze per stuk kunnen
uitzetten. Alles wat over jou persoonlijk gaat — je vergoeding, je voorkeuren,
de rondleiding — zit achter je naam rechtsboven, samen met Beheer voor wie dat
mag.

---

## 3. Hoe een wedstrijd in de lijst komt

Niet elke wedstrijd heeft eigen officials nodig. Er zijn drie manieren waarop
een wedstrijd in de beschikbaarhedenlijst terechtkomt:

**Automatisch.** U10 en U12 (categorieën G10, G12, M12). Daar duidt de bond
nooit scheidsrechters aan, dus die zijn altijd voor de club.

**De woensdagregel.** Elke woensdag om 14 uur kijkt de app naar het komende
weekend. Wedstrijden vanaf U14 waar Basketbal Vlaanderen minder dan twee
scheidsrechters heeft aangeduid, komen erbij. De YO+'ers krijgen daar bericht
van.

**Handmatig.** Een beheerder kan een wedstrijd toevoegen of net weglaten. Haalt
hij er een uit, dan onthoudt de app dat en haalt de woensdagregel ze niet
opnieuw binnen.

Staat er vanaf U14 geen scheidsrechter bij Basketbal Vlaanderen terwijl de
beheerder weet dat er wél twee komen, dan kan hij dat aanvinken. Dat wijst
niemand aan; het onderdrukt alleen de rode melding. Zodra de bond zelf twee refs
invult, verdwijnt die vlag vanzelf.

---

## 4. Aanduiden

Per wedstrijd zijn er twee plaatsen, REF1 en REF2, min wat de bond al heeft
gedaan. Een beheerder kiest uit wie zich beschikbaar zette.

**Botsingen** worden gemeten van aanvang tot aanvang: twee uur in dezelfde zaal,
tweeënhalf uur bij een andere. Wie te krap zit, wordt gemeld — de beheerder kan
alsnog doorgaan als hij weet dat het lukt.

**Automatisch aanvullen** stelt een verdeling voor: eerst de wedstrijden waar
weinig kandidaten voor zijn, en zo eerlijk mogelijk verdeeld over het seizoen.
Het toont eerst wat het zou doen; pas na bevestiging gebeurt het.

Een official die is aangeduid, kan zijn beschikbaarheid niet meer wijzigen. Lukt
het toch niet, dan meldt hij een probleem — dat gaat naar alle beheerders.

---

## 5. Wat er automatisch gebeurt

Eén taak per uur, die zelf beslist wat er op dat Brusselse uur moet gebeuren.

| Tijdstip | Wat |
|---|---|
| 0, 6, 12, 18 uur | Kalender ophalen bij Basketbal Vlaanderen |
| Woensdag 14 uur | Woensdagregel: weekendwedstrijden zonder twee refs erbij zetten |
| 19 uur | Herinnering aan wie morgen fluit |
| 20 uur | Nakijken of een toegevoegde wedstrijd intussen toch refs kreeg |
| 7 uur | Herinnering aan wie vandaag fluit |
| Maandag 8 uur | Overzicht naar beheerders van wat nog niet is aangeduid |

Herinneringen gaan alleen naar wie ze wil; dat staat per persoon in Mijn
voorkeuren.

**Verdwenen wedstrijden** worden gemarkeerd, nooit verwijderd — er hangen
beschikbaarheden aan. Verdwijnen er in één keer meer dan drie, dan gebeurt er
niets: dat wijst eerder op een storing bij de bond dan op drie afgelastingen.

---

## 6. Vergoedingen

Elke categorie heeft een tarief: €15 voor U10/U12, €20 tot en met U21, €25 voor
de senioren. Die staan in de databank en zijn aanpasbaar.

**Een maand afsluiten** kan vanaf de eerste dag van de volgende maand. Dat legt
de bedragen vast in een momentopname. Elke official krijgt zijn eigen overzicht
per mail; een instelbare lijst adressen krijgt de verzamelstaat — de
penningmeester hoeft daarvoor geen beheerder te zijn.

**Wat er nadien nog verandert**, raakt het bedrag van toen niet meer. Wordt een
aanduiding achteraf vrijgegeven, dan komt dat als correctieregel in de volgende
maand: *Correctie 2026-09: −1 × U12*. Zo klopt het totaal over het seizoen,
zonder dat een betaald bedrag met terugwerkende kracht verandert.

Afsluiten wordt geweigerd zolang er aanduidingen staan op een categorie zonder
tarief. Op nul zetten zou stil verkeerd zijn.

---

## 7. Waar het draait

| Onderdeel | Waar |
|---|---|
| De app en de API | Cloudflare Workers |
| De databank | Cloudflare D1 (SQLite) |
| Aanmelden | Cloudflare Access (Zero Trust) |
| Mail | Resend |
| Broncode | GitHub |
| Adres | `https://yoassist.org` |

Het oude adres `https://yoassist.jurgenvang.workers.dev` blijft ook werken.

**Eén Worker doet alles**: de webpagina, de API en de geplande taken zitten in
hetzelfde project. Er is geen aparte server, geen buildstap en geen framework.
De volledige frontend is één bestand, `public/index.html`.

**Kosten.** Alles draait binnen de gratis niveaus van Cloudflare en Resend, bij
een club van deze grootte ruim. D1 en Workers hebben royale dagelijkse limieten;
Resend staat een paar duizend mails per maand toe.

---

## 8. Aanmelden: twee lagen

Dit is het stuk dat het vaakst verwarring geeft, dus expliciet:

**Laag 1 — Cloudflare Access** bepaalt wie de app überhaupt mag openen. Wie op
`yoassist.org` komt, krijgt eerst een aanmeldscherm en vult zijn e-mailadres in;
Access stuurt een PIN. Dat adres moet in de Access-policy staan.

**Laag 2 — de `users`-tabel** bepaalt wat iemand mag zodra hij binnen is. Wie in
Access staat maar niet in `users`, krijgt een foutmelding.

**Die twee lijsten moeten handmatig gelijk blijven.** Voeg je een official toe in
YOAssist, dan moet zijn adres ook in Zero Trust bij de Access-policy. Het
beheerscherm levert daarom een kopieerklare lijst met alle actieve adressen.

Vergeet je laag 1, dan raakt de official niet binnen. Vergeet je laag 2, dan
komt hij binnen en krijgt hij een foutmelding.

---

## 9. Meldingen op de telefoon

Naast mail kan de app meldingen sturen naar het toestel. Elke gebruiker zet dat
zelf aan bij Mijn voorkeuren.

**Op een iPhone werkt dat alleen als de app op het beginscherm staat.** Openen in
Safari, tikken op het deelicoon, "Zet op beginscherm", en de app daarna via dat
icoon openen. Dat is een beperking van Apple, niet van YOAssist. Officials die
nog geen meldingen hebben, krijgen die uitleg onderaan elke mail.

Mail blijft daarom het betrouwbare kanaal en staat standaard aan.

---

## 10. Onderhoud

**Bij het begin van een seizoen**: het seizoen ophogen in het beheerpaneel, teams
opnieuw laden, en aanvinken welke ploegen gevolgd worden. Nieuwe ploegen met een
onbekende categorie staan bewust uit.

**Elke maand**: de vorige maand afsluiten bij Vergoedingen club.

**Af en toe**: een backup nemen. Dat is één JSON-bestand met alles erin. Er is
geen knop om hem terug te zetten — dat gebeurt handmatig via de D1-console, met
het bestand ernaast. In dat bestand staat in welke volgorde de tabellen ingelezen
moeten worden.

**Bij een nieuwe versie**: de bestanden naar GitHub, en Cloudflare deployt
vanzelf. Wijzigt de databank mee, dan staat erbij wat er moet gebeuren —
meestal een `ALTER TABLE`, soms een `DROP` gevolgd door een blok uit
`schema-console.sql`.

---

## 11. Als er iets misgaat

**"no such column: …"** — de databank loopt achter op de code. Er is een
schemawijziging niet uitgevoerd. Kijk in de release-uitleg welke.

**Een official raakt niet binnen** — zijn adres staat niet in de Access-policy in
Zero Trust. Zie hoofdstuk 8.

**Een official komt binnen maar krijgt een foutmelding** — hij staat wel in
Access maar niet in `users`, of hij is daar op inactief gezet.

**Er komt geen mail** — controleer het afzenderadres in het beheerpaneel en of
het domein nog geverifieerd is bij Resend.

**Synchroniseren geeft niets terug** — de API van Basketbal Vlaanderen is
ongedocumenteerd en kan zonder waarschuwing veranderen. Het logboek en het
scherm Synchronisatie tonen wat de laatste run deed.

**Het logboek** is de eerste plek om te kijken bij een vraag als "waarom staat
deze wedstrijd er zo bij". Elke wijziging, aanduiding en beheeractie staat er,
met wie het deed.

---

## 12. Als iemand het overneemt

Wat er nodig is om verder te kunnen:

- Toegang tot het **Cloudflare-account** (Workers, D1, Zero Trust)
- Toegang tot de **GitHub-repo**
- Toegang tot het **Resend-account**, of een eigen account met hetzelfde
  geverifieerde domein
- Beheerder zijn in YOAssist zelf

De code staat onder de **EUPL v1.2**: vrij te gebruiken, aan te passen en door te
geven onder dezelfde voorwaarden. Zie `LICENSE`.

Voor wie eraan verder wil bouwen zijn er 1034 tests die zonder netwerk draaien
met `cd test && npm test`. Ze zijn er niet voor de vorm: verschillende ervan
kwamen er nadat iets stil was misgegaan, en houden dat nu tegen.
