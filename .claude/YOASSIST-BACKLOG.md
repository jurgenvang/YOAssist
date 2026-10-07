# YOAssist — backlog

Upload dit als **projectkennis** naast `YOASSIST-CONTEXT.md`. Bijwerken bij elke
afgewerkte versie.

Stand: **v1.14.0**

---

## Afgewerkt

| Versie | Wat |
|---|---|
| 0.1 – 0.3 | Access-authenticatie, gebruikersbeheer, categorieherkenning, cluboverzicht |
| 0.4 | Scope per wedstrijd, handmatige toewijzing, woensdagregel, uurplanner |
| 0.5 | Automatische toewijzing met droogloop |
| 0.6 | Communicatiemodule (mail) |
| 0.7 | Weekendvenster, klikbare filters, groepering, refs op het YO-scherm |
| 0.8 | Gebruikers per rol, verwijderen, CSV-bulkupload |
| 0.9 | Eigen wedstrijden, CSV-import, overwrite-regel, sessieverloop |
| 0.10 | Vrijgeven per maand |
| 0.11 | Logboek |
| 0.12 | Push-notificaties en persoonlijke voorkeuren |
| 0.13 | Rondleiding |
| 0.14 | Reset per onderdeel, D1-parametergrens opgelost |
| 0.15 | Samenvouwbare secties |
| 0.16 | Backup-export |
| 0.17 | Naammenu in plaats van twee icoontjes |
| 0.18 | Facturatie met momentopnames en correcties |
| 0.19 | Zeven verbeteringen aan beide schermen |
| 0.20 | Verversen bij tabwissel, Vergoeding naar het naammenu, instelbare tabbladen, vlag voor refs buiten VBL |
| 0.20.1 | "Nog te beantwoorden" beperkt tot deze en volgende maand |
| 0.21 | Tekst bij beschikbaren, kaartpositie rondleiding, facturatie naar het menu, Over YOAssist met EUPL |
| 0.22 | Twee aparte rondleidingen, inhoudelijk herwerkt |
| 0.22.1 | Uitleg over meldingen aanzetten, met de iOS-stap, in mail en scherm |
| 0.23 | Kijken als official, met schakelaar in het naammenu |
| 0.24 | App-icoon, manifest, 'Zet op beginscherm' |
| **1.0** | Eerste volwaardige versie: eigen domein, werkende mail, EUPL v1.2 |
| 1.1 – 1.5 | Handleiding in de app, welkomstmail, telefoonnummers met bellen en WhatsApp, kaartlinks, kleuren per toestand |
| 1.6 | Mijn berichten, belangrijk nieuws, documenten |
| 1.7 | Beschikbaarheid namens een kind |
| 1.8 | Meldingenschakelaar per toestel, berichtopties, externe API, agendafeed |
| 1.9 | Uitslag bij gespeelde wedstrijden, herinnering wie nog niet invulde, Beheer gesplitst |
| 1.10 | Regio-pagina bij gevolgde clubs (aparte synchronisatie, vanaf U14), backup uitgebreid naar alle tabellen |
| 1.10.7 | Meldingenbolletje rechtstreeks naar Mijn berichten, teller ververst live terwijl het tabblad open staat, topbalk herzien (club onder YOAssist, rol(len) onder de eigen naam) |
| 1.10.8 | REF-balk op het aanduidingenscherm smaller (max-breedte i.p.v. volledige kaartbreedte), herinnering om het eigen gsm-nummer in te vullen bij een eigen aanduiding, naammenu opgesplitst in Beheer en persoonlijk deel |
| 1.10.9 | Welkomstmail: "Sign in with Cloudflare" vermeld vóór Google/Apple, uitleg over welke wedstrijden de app dekt (U10/U12, en vanaf U14 zonder VBL-scheidsrechters); Regio-pagina toont thuis- en uitploeg nu als aparte, afbrekende velden i.p.v. één te brede regel |
| 1.11.0 | V36: Vergoedingen club toont per official de wedstrijden zelf (datum, ploegen, categorie), ook bij een afgesloten maand; in een open maand kan een wedstrijd weggehaald worden (= aanduiding vrijgeven); vrijgave op een voorbije wedstrijd stuurt geen bericht meer. Tests rekenen hun datums voortaan relatief tegenover vandaag |
| 1.12.0 | V35: cluboverzicht kan voorbije wedstrijden tonen (vanaf de eerste van de vorige maand, eigen groep onderaan, enkel voor beheerders) om achteraf aanduidingen recht te zetten; aanduiden op een voorbije wedstrijd stuurt geen bericht; voorbije wedstrijden tellen nooit mee in de cijfers |
| 1.12.1 | V37: Mijn vergoeding en de maandmail tonen ook de wedstrijden zelf (datum, ploegen, categorie, correcties met teken); een afgesloten maand toont wat er toen meetelde |
| 1.12.2 | V38: lange berichten in Mijn berichten zijn open te klappen ('lees meer'), met de volledige tekst zoals verstuurd en klikbare links; samenvatting van lang nieuws eindigt op '…' i.p.v. midden in een zin. Schema: kolom `berichten.volledig` (ALTER) |
| 1.13.0 | V40: forfait herkennen (`AFOR`/`BFOR` in de uitslag van de bond, vaak al weken op voorhand); woensdagregel, herinneringen, automatisch aanvullen en 'nog te beantwoorden' slaan forfaitwedstrijden over; officials zien 'gaat niet door'; eigen aanduidingen automatisch vrijgegeven als het forfait vóór de wedstrijddag gekend is (instelbaar: of enkel melden); forfait gemarkeerd in de vergoedingen. Ook: keuzelijst 'Extern lezen' toonde na herladen altijd 'initialen'. Schema: kolom `matches.forfait` en instelling `forfait_aanduiding` |
| 1.14.0 | V39: de woensdaglijst van Basketbal Vlaanderen is de bron van de woensdagregel. De app ontvangt de mail zelf (Cloudflare Email Routing, rechtstreeks of doorgestuurd vanuit Gmail), haalt het Excel-bestand op en leest het uit, koppelt de eigen thuiswedstrijden, en verwerkt om 14 uur; geen lijst om 14 uur = waarschuwing, om 20 uur terugval op de API. Afwijkingen en niet te koppelen ploegen naar de beheerders; status bij Beheer. 'Nog nodig' volgt de lijst. Ook: de backup miste 9 van de 21 tabellen (o.a. de facturatie); nu alle 22, met een test tegen het schema. Schema: kolom `matches.bond_officials`, tabel `vbl_lijsten`. Samen met v1.13.0 uitgerold, met één SQL-script |

---

## Openstaand

### V26 — Overzicht van wie meldingen heeft aanstaan
**Nog uit te werken.** Een lijst of teller bij Beheer die toont wie er
push-meldingen op minstens één toestel heeft geactiveerd, zodat je kan
inschatten hoeveel officials via mail alléén bereikt worden versus mail en
meldingen samen.

Nog te bepalen: enkel een teller ('14 van de 22 hebben meldingen aan'), of een
volledige lijst per persoon met welke toestellen? Dat laatste raakt privacy
lichtjes — het toont iets over het gedrag van een official (heeft hij de moeite
gedaan om het in te stellen), dus vermoedelijk enkel zichtbaar voor beheerders,
niet voor andere officials.

### V32 — Pushmelding tikken op smartphone: uitzoeken of het echt naar Mijn berichten gaat
**Nog uit te zoeken, geen bug bevestigd.** Ontstaan uit een vraag of tikken op
een pushmelding op de telefoon meteen naar Mijn berichten gaat. De code in
`public/sw.js` (`notificationclick`) doet dat al, in twee gevallen:

- App staat nog niet open → `self.clients.openWindow('/?open=berichten')`;
  `index.html` leest die parameter bij het laden en opent het paneel.
- App staat al open (voor- of achtergrond) → het venster wordt naar voren
  gehaald met `.focus()` en krijgt een boodschap (`{type: 'open-berichten'}`)
  waarop het paneel opent zonder herlaad.

Dat mechanisme bestond al vóór v0.24 en is dus niet nieuw gebouwd. Op basis van
de code alleen kon niet bevestigd worden of het op een echt toestel ook zo
voelt — dat vraagt een test met een echte melding op een echte telefoon
(Android én iPhone apart, telkens met de app op het beginscherm én gewoon in
de browser).

Nog te bepalen bij het testen:
- Gaat het inderdaad naar Mijn berichten, of blijft de telefoon op het
  aanduidingenscherm staan?
- Verschil tussen Android en iPhone, en tussen 'op het beginscherm gezet' en
  'gewoon in de browser'?
- Als het niet werkt: gebeurt er dan niets, of gaat het naar de verkeerde
  plek?

Hangt samen met het bredere punt onderaan CONTEXT.md: de app is nog nooit met
echte officials op echte toestellen getest.

### V33 — Dagelijkse opruiming van de databank (logboek, sync_runs)
**Nog uit te werken.** `berichten` heeft al een opruiming: `kuisBerichtenOp()`
wist rijen ouder dan 120 dagen, aangeroepen vanuit de bestaande `opkuis`-taak
in de uur-cron (`src/index.js`). Die functie zegt in haar eigen commentaar
letterlijk "Dezelfde aanpak als het logboek" — maar voor `logboek` en
`sync_runs` bestaat die opruiming niet. Beide groeien ongelimiteerd:
`logboek` krijgt een rij bij elke synchronisatie, wijziging, aanduiding en
beheeractie; `sync_runs` een rij per synchronisatieronde (vier keer per dag
via de cron, plus elke handmatige run erbovenop).

Voorstel om op verder te bouwen: dezelfde `opkuis`-taak uitbreiden met een
`kuisLogboekOp()` en `kuisSyncRunsOp()`, naar het voorbeeld van
`kuisBerichtenOp()`.

Nog te bepalen:
- **Bewaartermijn per tabel**, en die hoeft niet gelijk te zijn. `logboek` is
  volgens DOCUMENTATIE.md "de eerste plek om te kijken bij een vraag als
  'waarom staat deze wedstrijd er zo bij'" — te snel wissen ondermijnt dat
  doel. `sync_runs` is puur operationeel/diagnostisch en kan waarschijnlijk
  met een kortere termijn.
- **Nooit iets wissen dat nog opvolging vraagt.** `logboek.afgehandeld = 0`
  markeert wedstrijdwijzigingen die nog bekeken moeten worden; die horen
  nooit automatisch te verdwijnen, hoe oud ook, tot een beheerder ze afhandelt.
  Enkel `afgehandeld = 1`-rijen (en sowieso alle `beheer`-rijen, die staan al
  meteen op 1) zouden na de bewaartermijn mogen verdwijnen.
- Of dit gewoon een `DELETE ... WHERE vastgesteld < datetime('now', ?)` wordt
  zoals bij `berichten`, of dat er eerst nog samengevat/gearchiveerd moet
  worden vóór het wissen.

### V34 — Ploegverantwoordelijken en coaches informeren bij te weinig scheidsrechters
**Nog uit te werken.** Drie onderdelen, uit de vraag zelf:

**1) Beheer: aparte lijst van PV en aparte lijst van coaches** — twee eigen
lijsten, niet één gecombineerde lijst met een type-veld. Elk geladen via een
sjabloon met kolommen Voornaam, Naam, e-mail, team. Belangrijk verschil met de
bestaande CSV-import van gebruikers: dit zijn geen YOAssist-gebruikers. PV's
en coaches loggen niet in, zitten niet achter Cloudflare Access, en hebben
geen rol (YO/YO+/Beheerder). Dit wordt dus vermoedelijk twee nieuwe tabellen —
geen uitbreiding van `users` — met enkel contactgegevens gekoppeld aan een
team (`team`-veld, te koppelen aan de bestaande teams-tabel/GUID's uit de
VBL-sync). **Meer dan één PV en meer dan één coach per team kan**; bij een
tekort aan scheidsrechters krijgen ze dan allemaal een mail.

**2) Bericht op woensdagavond, opnieuw op donderdag.** Als er voor hun
wedstrijd geen of maar één scheidsrechter is, krijgen alle PV's en coaches van
dat team
een mail dat er een oplossing wordt gezocht. Is dat op donderdag nog niet
gelukt, volgt een tweede bericht. Dit sluit aan bij de bestaande woensdagregel
(woensdag 14u, weekendwedstrijden met minder dan twee VBL-refs) maar is er niet
hetzelfde als: die regel voegt wedstrijden toe aan de lijst en verwittigt de
eigen YO+'ers; dit nieuwe stuk verwittigt externe contacten op een later
moment (avond) over hetzelfde soort wedstrijden, en opnieuw op donderdag als
het probleem blijft bestaan.

**3) De sjabloonexport moet alle ploegen bevatten die beheerd/geladen worden**
(dus elk gevolgd team uit de teams-tabel), met de reeds ingevulde PV's en
coaches erbij — niet enkel de teams waar al iemand voor is ingevuld, en niet
enkel een lege lay-out. Zo ziet een beheerder in één overzicht welke teams nog
geen PV of coach hebben. Dat wijkt af van hoe het sjabloon voor gebruikers nu
werkt (`GET /api/admin/users/template`): dat is vandaag een leeg sjabloon met
één voorbeeldregel, bedoeld om de vorm te tonen — niet om ingelezen te worden
en niet gevuld met bestaande data. Voor PV/coaches moet het sjabloon dus een
andere aanpak krijgen (of enkel voor deze twee sjablonen, of een algemene
wijziging aan hoe sjablonen werken — te bepalen).

Nog te bepalen:
- Exacte tijdstippen op woensdagavond en donderdag (de bestaande cron draait
  per uur; dit wordt vermoedelijk twee nieuwe taken daarin, naar het patroon
  van de woensdagregel en de wekelijkse herinneringen).
- Gaat dit via `verwittigen.js`, zoals de vaste regel in INSTRUCTIES.md
  voorschrijft ("berichten altijd via verwittigen.js")? Dat kanaal is nu
  gebouwd rond geregistreerde `users` met een eigen voorkeur (mail/push); een
  PV/coach heeft geen account en dus geen voorkeur — dit vraagt vermoedelijk
  een uitbreiding van `verwittigen.js` voor mail-only externe ontvangers, in
  plaats van rechtstreeks naar `mailer.js` te gaan.
- Toon van het tweede bericht (donderdag): een herhaalde herinnering, of een
  erkenning dat het (nog) niet gelukt is?
- Telt "maar één scheidsrechter" even zwaar als "geen enkele", of is één toch
  voldoende om geen bericht te sturen?

### V41 — Regio: G08-wedstrijden horen er niet in
**Bug, klaar om te bouwen.** In Regio staan ook wedstrijden van G08. Daar
wordt nooit een scheidsrechter of Youth Official voor voorzien, dus ze horen
er nooit in te staan.

Oorzaak: `volgsync.js` werkt met een uitsluitingslijst (`ZONDER_U10U12` =
G10, G12, M12) in plaats van met wat er wél in mag. Alles wat daar niet in
staat glipt door — G08, maar ook ROL, een onbekende code, of een wedstrijd
waarvan `categorieUitGuid()` null teruggeeft (die wordt nu doorgelaten).

Voorstel (standaardkeuze): omdraaien naar een toelatingslijst — enkel de
categorieën vanaf U14 uit de categorietabel (G14, M14, J16, M16, J18, M19,
J21, HSE, DSE); een onbekende of ontbrekende code valt eruit. Zo komt een
nieuwe jeugdcategorie van de bond er niet ongemerkt bij. Bestaande
G08-rijen verdwijnen vanzelf bij de volgende volgsync (opruiming op
tijdstempel). Geen schemawijziging.

Nog te bepalen: niets, tenzij de toelatingslijst uit de databank (tarieven)
moet komen in plaats van vast in de code. Voorstel: vast in de code — de
tarieventabel bevat ook U10/U12.

### V42 — Regio bijwerken met de woensdaglijst van de bond
**Nog uit te werken.** De woensdaglijst (V39) bevat alle wedstrijden van het
komende weekend in heel Vlaanderen met 0 of 1 official — dus ook die van de
gevolgde clubs. Daarmee kan Regio hetzelfde rechtzetten als bij de eigen
wedstrijden: wat níet in de lijst staat, heeft volgens de bond 2 officials,
ook als de API nog niemand toont.

Wat er al is: `woensdaglijst.js` leest de volledige lijst al in en koppelt op
datum + uur + thuisploeg (genormaliseerd). `vbl_lijsten` bewaart echter enkel
de eigen wedstrijden (`eigen`), niet de rest van de lijst.

Voorstel (standaardkeuze): bij het verwerken van de lijst ook koppelen tegen
`volg_wedstrijden` (zelfde sleutel, `thuis_naam`), en het resultaat in een
nieuwe kolom `volg_wedstrijden.bond_officials` zetten, naar het voorbeeld van
`matches.bond_officials`. Regio toont dan het hoogste van API en lijst; een
wedstrijd die niet in de lijst staat, verdwijnt uit Regio. Schema: één kolom
erbij, `ALTER TABLE ... ADD COLUMN` volstaat.

Nog te bepalen:
- De lijst dekt enkel het komende weekend; Regio toont er twee. Het tweede
  weekend blijft op de API leunen — expliciet zo tonen, of niets doen?
- Volgorde met de volgsync: die draait om 5 uur en schrijft de rijen
  opnieuw. Mag die `bond_officials` niet overschrijven (kolom niet aanraken
  in de upsert), en wanneer vervalt de waarde — na het weekend vanzelf,
  want dan valt de wedstrijd buiten Regio.
- Een gevolgde ploeg uit de lijst die niet te koppelen is (verschoven uur):
  melden aan de beheerders zoals bij de eigen ploegen, of stil laten?
- Komt er een eigen verversing van Regio direct na het verwerken van de
  lijst, of volstaat het dat de pagina het bij het volgende openen toont?

### V43 — Eigen aanduidingen bij Basketbal Vlaanderen in het aanduidingenscherm
**Beslist, eerst uit te zoeken, dan te bouwen.** Officials die ook door de
bond worden aangeduid, zien die wedstrijden nu niet in YOAssist. Voorbeeld:
zondag 11/10 om 10u, GSG Aarschot G14C — een aanduiding van Basketbal
Vlaanderen bij een andere club. Die wedstrijden moeten in het
aanduidingenscherm komen, met een eigen tag en achtergrondkleur die duidelijk
maakt dat het een aanduiding van de bond is, geen aanduiding van de club.

**Beslist:**
- **Zoekgebied: heel Vlaanderen**, niet enkel de eigen en gevolgde clubs.
- **Telt niet mee voor de vergoeding** — de bond betaalt die zelf.
- **Agendafeed en herinneringen: aan/uit in Mijn voorkeuren, standaard
  aan.** Eén schakelaar die beide regelt (agenda én herinneringen dag
  ervoor / dag zelf); de bestaande schakelaars `herinner_avond` en
  `herinner_ochtend` blijven daarbovenop gelden.
- **De zoeknaam staat in Mijn voorkeuren**, zichtbaar en aanpasbaar door de
  official zelf (en door de beheerder). De naam bij de bond kan licht
  afwijken van die in YOAssist. Leeg = zoeken op de gewone naam.
- **Waar een beheerder de zoeknaam aanpast** (voorstel): bij Beheer →
  Gebruikers, met een knopje **vbl** in de rij, naast *welkom*, *ouder* en
  *aan/uit* — zelfde patroon als *ouder*. Het toont de huidige zoeknaam
  (of de gewone naam als die leeg is) en laat ze aanpassen of leegmaken.
  Wijkt de zoeknaam af van de gewone naam, dan staat ze onder de naam in de
  rij ('VBL: …'), zoals 'vult in voor …'. Backend: een extra veld `vblNaam`
  in de bestaande `PATCH /api/admin/users`; leeg = NULL. Een ouder past de
  zoeknaam van zijn kind aan via Mijn voorkeuren met de keuzelijst 'namens'.

**Eerst uitzoeken.** De API heeft geen endpoint 'alle wedstrijden van een
scheidsrechter'. Het enige spoor is `wedOff`, een lijst met namen bij elke
wedstrijd, en die is enkel per club (`OrgMatchesByGuid`) of per ploeg op te
vragen. Heel Vlaanderen doorzoeken betekent dus: elke club apart ophalen.
Na te gaan:
- **Hoe aan de lijst van alle clubs te komen.** Er is geen endpoint 'alle
  clubs'. Opties: de clubnummers `BVBL0001`–`BVBL9999` één keer aftasten en
  de bestaande bewaren (per seizoen herhalen), of de clubs afleiden uit de
  tegenstanders in de wedstrijden (`tTGUID`/`tUGUID`) en zo uitbreiden tot er
  niets nieuws meer bijkomt.
- **Hoeveel calls de Worker per run mag doen.** Cloudflare beperkt het
  aantal subrequests per aanroep (50 op het gratis plan). Met een paar
  honderd clubs moet de ophaling dus over meerdere uren gespreid worden —
  bv. een deel van de clubs per uur, in een vaste rotatie, zodat elke club
  minstens één keer per dag aan bod komt.
- **Bestaat er toch een endpoint per persoon** (de verkenning en de spec van
  2015 toonden er geen)?
- **In welke vorm staat een naam in `wedOff`** ('Voornaam Naam', 'NAAM
  Voornaam', met of zonder licentienummer)?

**Voorstel voor de bouw:**
- **Koppelen op naam, losjes maar niet te los**: hoofdletters, accenten,
  dubbele spaties en de volgorde voornaam/naam niet laten meetellen. Wat
  daarbuiten afwijkt, lost de official op door zijn zoeknaam aan te passen.
- **Bewaren** in een nieuwe tabel `vbl_aanduidingen` (wedstrijd-guid, user,
  datum, uur, ploegen, categorie, zaal, laatst gezien), gevuld door een
  aparte synchronisatie naar het voorbeeld van `volgsync.js`. Enkel wat bij
  een eigen gebruiker hoort; de andere namen uit `wedOff` zijn
  persoonsgegevens en worden niet bewaard. Niet in `matches`: daar zouden ze
  in woensdagregel, facturatie of eigen herinneringen belanden.
- **Tonen** tussen de eigen aanduidingen, met label 'VBL' en een eigen
  achtergrondkleur; alleen-lezen, geen knoppen.
- **Botsingscontrole**: een clubaanduiding die botst met een VBL-aanduiding
  van dezelfde persoon, melden bij het aanduiden (zelfde regels: twee uur
  zelfde zaal, tweeënhalf uur anders).

**Schema:** in `users` twee kolommen erbij — `vbl_naam TEXT` (NULL = de
gewone naam) en `vbl_aanduidingen INTEGER NOT NULL DEFAULT 1` — met
`ALTER TABLE ... ADD COLUMN`. Nieuwe tabel `vbl_aanduidingen` (en eventueel
`vbl_clubs` voor de clublijst en de rotatie) met een gewone `CREATE TABLE`.
Geen DROP nodig. Beide nieuwe tabellen ook in de backup (`TABELLEN`).

Nog te bepalen:
- Zien beheerders de VBL-aanduidingen van een official ook (cluboverzicht,
  bij het aanduiden), of enkel de official zelf? Voorstel: beheerders zien
  ze bij het aanduiden als reden voor een botsing, niet als aparte lijst.
- Hoe snel na een aanduiding door de bond moet ze in YOAssist staan? Bepaalt
  de rotatie (één keer per dag lijkt genoeg).

### V29 — Evaluatiemodule
**Nog uit te werken, zeer open.** Een manier om Youth Officials te evalueren
na een wedstrijd. Nog geheel te bepalen: wie evalueert (een beheerder, een
mede-official, de club), welke criteria, op welk moment, en of de official
zelf de evaluatie te zien krijgt. Raakt vermoedelijk het datamodel met een
nieuwe tabel gekoppeld aan `assignments`.

### V30 — Een aparte demo-omgeving
**Aanpak gekozen, verder uit te werken.** Dient voor twee dingen tegelijk: aan
andere clubs laten zien wat de app kan, én zelf nieuwe functies uitproberen
zonder de echte club te raken.

**Gekozen: optie A, een volledig aparte Worker met eigen D1-databank**, op een
eigen (sub)domein, bijvoorbeeld `demo.yoassist.org`. Volledig gescheiden van de
echte club — geen risico dat demo-gegevens en echte gegevens door elkaar lopen.

Overwogen en verworpen: één demomodus binnen dezelfde Worker (een vlag die
demo-gegevens markeert). Minder onderhoud, maar te veel risico: elke plek waar
de app 'alle clubs' of 'alle gebruikers' doorloopt (synchronisatie, facturatie,
het beheerscherm) zou de filter correct moeten toepassen, en mail versturen zou
voor demo-gebruikers apart onmogelijk gemaakt moeten worden. Eén gemiste plek
betekent dat een nepofficial een echte mail krijgt, of omgekeerd.

**Wat dit kost, expliciet meegenomen in de keuze:** een tweede installatie om
te onderhouden. Elke nieuwe versie en elke schemawijziging moet twee keer
gedeployed worden — eenmaal voor de echte club, eenmaal voor de demo. Zonder
dat bewust bij te houden, loopt de demo op termijn een paar versies achter.

Nog te bepalen:
- Realistische naamgeving (club, teams, officials) die overtuigend oogt voor
  wie de demo bezoekt, zonder dat het op echte namen lijkt.
- Een manier om de demo makkelijk terug te zetten naar een schone staat, voor
  het tweede doel (zelf experimenteren zonder rommel te laten liggen).
- Wie toegang krijgt tot de demo-Worker, en of daar een eigen, simpelere
  aanmelding voor komt (een demo hoeft niet achter dezelfde Access-policy te
  zitten als de echte club).

### V8b — Supabase in plaats van Cloudflare Access
**Afgeraden, tenzij er een reden opduikt.** Zou Access vervangen als eerste
laag, met een eigen JWT dat de Worker moet verifiëren. Voegt een derde partij
toe naast Cloudflare en Resend, en bij "alleen voor niet-admins" zouden er twee
parallelle inlogsystemen ontstaan. Als de aanleiding is dat de PIN-per-mail
omslachtig aanvoelt, lost punt U hetzelfde op zonder extra partij.

### U — Microsoft 365 als identity provider
**Gesloten, geen actie.** Niet iedereen heeft een Microsoft-account van de club
— sommigen wel, de meesten niet. Zonder volledige dekking moet de PIN-per-mail
sowieso blijven bestaan als terugvalmogelijkheid, dus dit vervangt niets en voegt
enkel een tweede aanmeldmethode toe zonder een probleem op te lossen.

Verandert de situatie ooit — krijgt iedereen een clubaccount — dan is dit zonder
veel werk alsnog toe te voegen: Cloudflare Access ondersteunt Microsoft Entra ID
als standaardintegratie, en de code van YOAssist verandert er niet door.
