# YOAssist — projectinstructies

Kort en stabiel: dit zijn werkafspraken, geen documentatie. De feiten over het
project staan in `context.md`.

---

Je werkt aan YOAssist, een webapplicatie voor het beheer van beschikbaarheden en
aanduidingen van Youth Officials bij basketbalclub AB InBev Leuven Bears.
Antwoord in het Nederlands.

## Werkwijze

- **Bij het afronden van een versie: gebruik de skill `yoassist-release` als
  die beschikbaar is.** Die legt het volledige releaseproces vast (testsuite,
  versienummer, schema herbouwen, zip en delta-zip samenstellen,
  projectdocumenten synchroniseren). Staat de skill niet ter beschikking in het
  gesprek, volg dan hieronder hetzelfde proces stap voor stap — de afspraken
  gelden sowieso, met of zonder skill.

- **Eerst uitklaren, dan bouwen.** Bij een nieuwe wens: stel de vragen die het
  datamodel of de gebruikerservaring raken vóór je code schrijft. Doe een
  voorstel met een standaardkeuze in plaats van open vragen te stellen.
- **Eén pakket per versie, met twee zips.** Werk een afgebakend onderdeel af,
  verhoog het versienummer in `src/versie.js`, en lever:
  1. een **volledige zip** met de hele projectstructuur, klaar om zo naar
     GitHub te zetten;
  2. een **delta-zip** met enkel de bestanden die deze versie zijn toegevoegd
     of gewijzigd, in dezelfde mapstructuur, plus een `WIJZIGINGEN.md` erin
     met per bestand een korte reden en, als het schema wijzigt, of een
     `ALTER TABLE` volstaat of dat er gedropt moet worden.

  Vraag daarna of je doorgaat. Bouw niet twee pakketten in één beurt.
- **Houd de projectdocumenten in sync met het versienummer.** Elke release
  werkt `src/versie.js`, `YOASSIST-BACKLOG.md`, `context.md` en
  `YOASSIST-DOCUMENTATIE.md` bij, en `instructions.md` als werkafspraken
  veranderen. Een release waarbij dat is overgeslagen (v1.10.8) moest achteraf
  rechtgetrokken worden.
- **Vertel wat er in de databank moet veranderen.** Bij elke schemawijziging:
  zeg meteen of een `ALTER TABLE ... ADD COLUMN` volstaat, of dat er gedropt moet
  worden. Een gewone kolom erbij kan met ALTER; een gewijzigde CHECK, een
  hernoemde tabel of een nieuwe foreign key niet. Zonder die vermelding moet de
  gebruiker het telkens opnieuw vragen, en gooit hij intussen data weg die had
  kunnen blijven.

## Kwaliteitseisen

- **Alles wat je bouwt heeft tests.** Ze draaien zonder netwerk, met
  `cd test && npm test`. Nieuwe logica zonder test is niet af.
- **Verifieer dat een nieuwe test echt kan falen.** Draai hem één keer tegen de
  fout die hij moet vangen. Een test die nooit rood is geweest, bewijst niets.
- **Controleer elke tekstvervanging.** Gebruik `assert t.count(oud) == 1` bij
  het aanpassen van bestanden. Een vervanging die stilzwijgend niets doet, is in
  dit project meermaals de oorzaak van een bug geweest.
- **Wijzig je de vorm van een API-respons**, controleer dan `test/aandacht.test.mjs`
  én `test/frontend.test.mjs` op verwijzingen naar de oude veldnamen.
- **Schrijf commentaar dat het waarom uitlegt**, niet het wat. Nederlands.

## Vaste regels van de applicatie

- De gebruiker komt altijd uit de geverifieerde identiteit, nooit uit de request
  body. De frontend verbergt knoppen voor het gemak; de backend weigert de actie
  voor de veiligheid.
- Alles wat gegevens wist of verstuurt, is eerst een droogloop: tonen wat er zou
  gebeuren, pas na bevestiging uitvoeren.
- Berichten gaan altijd via `verwittigen.js`, nooit rechtstreeks naar
  `mailer.js` of `push.js`.
- Loggen mag de actie zelf nooit laten mislukken.
- D1 staat maximaal honderd gebonden parameters per query toe. Filter op
  voorwaarden, nooit op een lijst sleutels.
