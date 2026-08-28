-- YOAssist — beschikbaarheden en aanduidingen voor Youth Officials
-- D1 (SQLite). E-mailadressen en GUID's altijd genormaliseerd opgeslagen:
-- e-mail in lowercase, GUID exact zoals Basketbal Vlaanderen ze teruggeeft.

-- ---------------------------------------------------------------------------
-- settings: losse sleutel/waarde. Gebruikt voor het actieve seizoen en voor
-- afgeleide status zoals het tijdstip van de laatste geslaagde synchronisatie.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  sleutel  TEXT PRIMARY KEY,
  waarde   TEXT NOT NULL,
  gewijzigd TEXT NOT NULL DEFAULT (datetime('now'))
);

-- seizoen_start_jaar = 2026 betekent seizoen 2026-2027, dus juli 2026 t/m juni 2027.
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('seizoen_start_jaar', '2026');

-- Mailconfiguratie. Het afzenderadres is hier instelbaar, niet in code, zodat
-- een clubwissel van domeinnaam geen deploy vereist. De API-sleutel van de
-- maildienst hoort hier NIET: die staat als secret bij de Worker.
-- Leeg totdat een beheerder het invult; de communicatiemodule blijft uit tot
-- dan.
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('mail_afzender', '');
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('mail_afzender_naam', 'YOAssist');

-- Wie de maandelijkse verzamelstaat krijgt. Komma- of nieuweregelgescheiden.
-- Bewust los van wie beheerder is: de penningmeester hoeft dat niet te zijn.
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('facturatie_ontvangers', '');

-- Welke aanmeldmethodes in Zero Trust aanstaan. Komt in de welkomstmail te
-- staan; wat hier niet in staat wordt niet genoemd. Een instructie die naar een
-- knop verwijst die er niet is, kost meer uitleg dan ze bespaart.
-- Mogelijke waarden: pin, google, apple, microsoft, github
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('aanmeld_methodes', 'pin');

-- Toont de externe API en de agendafeed initialen (standaard) of volledige
-- namen. Mogelijke waarden: 'initialen', 'volledig'.
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('extern_namen', 'initialen');


-- ---------------------------------------------------------------------------
-- categorieen: de drieletterige code uit de ploeg-GUID (BVBL1125J16  1 -> J16)
-- vertaald naar leeftijdsgroep en tarief.
--
-- Bewust een tabel en geen code: tarieven wijzigen, en er duiken codes op die
-- vandaag nog niet bestaan. Een onbekende code wordt gemeld in plaats van
-- stilzwijgend in een categorie te belanden — anders factureer je over twee
-- jaar een ploeg aan het verkeerde tarief zonder dat iemand het merkt.
--
-- auto_scope = 1: wedstrijden van deze categorie komen vanzelf in de lijst.
-- Voor alle andere moet een beheerder ze aanduiden, of moet de woensdagregel
-- vaststellen dat Basketbal Vlaanderen er minder dan twee scheidsrechters op
-- heeft gezet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categorieen (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  groep       TEXT NOT NULL,
  tarief_cent INTEGER NOT NULL,
  auto_scope  INTEGER NOT NULL DEFAULT 0,
  volgorde    INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO categorieen (code, label, groep, tarief_cent, auto_scope, volgorde) VALUES
  ('G10', 'U10',            'U10U12', 1500, 1, 10),
  ('G12', 'U12',            'U10U12', 1500, 1, 20),
  ('M12', 'U12 meisjes',    'U10U12', 1500, 1, 30),
  ('G14', 'U14',            'U14',    2000, 0, 40),
  ('M14', 'U14 meisjes',    'U14',    2000, 0, 50),
  ('J16', 'U16',            'U16',    2000, 0, 60),
  ('M16', 'U16 meisjes',    'U16',    2000, 0, 70),
  ('J18', 'U18',            'U18',    2000, 0, 80),
  ('M19', 'U19 meisjes',    'U19',    2000, 0, 90),
  ('J21', 'U21',            'U21',    2000, 0, 100),
  ('HSE', 'Heren senioren', 'SEN',    2500, 0, 110),
  ('DSE', 'Dames senioren', 'SEN',    2500, 0, 120);

-- ---------------------------------------------------------------------------
-- clubs: door de admin geconfigureerd via de club-GUID (BVBL + 4 cijfers).
-- naam wordt opgehaald bij Basketbal Vlaanderen als controle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clubs (
  guid        TEXT PRIMARY KEY,
  naam        TEXT,
  actief      INTEGER NOT NULL DEFAULT 1,
  toegevoegd  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- users: Access bepaalt wie binnen mag, deze tabel wat hij mag en ziet.
--   is_admin : toegang tot het beheermenu
--   profiel  : YO ziet teams met vlag yo, YO+ ziet teams met vlag yo_plus
--   club_guid: een YO hoort bij één club en ziet alleen die wedstrijden
-- Voornaam en achternaam staan apart zodat lijsten op achternaam kunnen sorteren.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  email       TEXT PRIMARY KEY,
  voornaam    TEXT NOT NULL,
  achternaam  TEXT NOT NULL,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  profiel     TEXT NOT NULL DEFAULT 'YO' CHECK (profiel IN ('YO', 'YO+')),
  club_guid   TEXT REFERENCES clubs (guid) ON DELETE SET NULL,
  gsm         TEXT,
  actief      INTEGER NOT NULL DEFAULT 1,
  -- Berichtvoorkeuren. Mail staat standaard aan en is het betrouwbare kanaal;
  -- push moet de gebruiker zelf activeren omdat de browser toestemming vraagt.
  kanaal_mail INTEGER NOT NULL DEFAULT 1,
  kanaal_push INTEGER NOT NULL DEFAULT 0,
  -- Herinneringen staan standaard aan. Wie ze niet wil, zet ze zelf af.
  herinner_avond   INTEGER NOT NULL DEFAULT 1,
  herinner_ochtend INTEGER NOT NULL DEFAULT 1,
  -- Komma-gescheiden lijst van tabbladen die deze gebruiker niet wil zien.
  -- Een persoonlijke voorkeur, geen rechten: de backend blijft weigeren wat
  -- iemand niet mag, ongeacht wat hier staat.
  --
  -- Het logboek en de aandachtspagina staan standaard uit. Beide zijn
  -- controle-instrumenten die je opent wanneer je iets wil nakijken, geen
  -- dagelijkse schermen — en elk tabblad dat je zelden gebruikt kost elke dag
  -- ruimte op een telefoon.
  verborgen_tabs TEXT NOT NULL DEFAULT 'log,aandacht',
  -- Of het gsm-nummer zichtbaar mag zijn voor wie samen op dezelfde wedstrijd
  -- staat. Beheerders zien het altijd; dit gaat enkel over collega's onderling.
  -- Staat standaard aan, want elkaar kunnen bereiken is het punt.
  gsm_delen   INTEGER NOT NULL DEFAULT 1,
  -- Voor de persoonlijke agendafeed (.ics). Leeg tot iemand voor het eerst op
  -- 'Kopieer mijn agenda-link' klikt; dan pas wordt hij aangemaakt. De
  -- beveiliging zit in deze lange, willekeurige waarde zelf, want een
  -- agenda-app kan geen header meesturen zoals de externe API dat wel kan.
  agenda_sleutel TEXT
);

-- Officials sorteer je op achternaam. Tussenvoegsels ('Van der Elst') horen bij
-- de achternaam: in Vlaanderen sorteert die onder de V, niet onder de E.
-- COLLATE NOCASE is hier geen detail: zonder die vermelding sorteert SQLite op
-- bytewaarde, en dan komt 'Van Meerbeeck' vóór 'van Geijstelen' omdat elke
-- hoofdletter kleiner is dan elke kleine letter. Zoek daar maar eens naar in een
-- ledenlijst. Queries die op naam sorteren moeten COLLATE NOCASE herhalen,
-- anders wordt deze index niet gebruikt.
CREATE INDEX IF NOT EXISTS idx_users_naam
  ON users (achternaam COLLATE NOCASE, voornaam COLLATE NOCASE);


-- ---------------------------------------------------------------------------
-- push_abonnementen: één rij per toestel, niet per gebruiker. Iemand kan de app
-- op zijn gsm én op een laptop hebben staan.
--
-- Abonnementen verlopen stil: de pushdienst antwoordt dan met 404 of 410. Die
-- rij wordt dan verwijderd — een verlopen abonnement blijven proberen levert
-- alleen ruis op.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_abonnementen (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email  TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  toestel     TEXT,
  aangemaakt  TEXT NOT NULL DEFAULT (datetime('now')),
  laatst_ok   TEXT,
  mislukt     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_abonnementen (user_email);

-- ---------------------------------------------------------------------------
-- teams: opgehaald bij Basketbal Vlaanderen per club.
--   volgen : haal de wedstrijden van deze ploeg op. Standaard ja. Uitzetten is
--            bedoeld voor ploegen die buiten de werking vallen.
--            Of een wedstrijd in de aanduidingslijst komt, wordt NIET meer hier
--            beslist maar per wedstrijd — zie matches.scope.
--   actief : stond dit team in de laatste opgehaalde teamlijst
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  guid          TEXT PRIMARY KEY,
  club_guid     TEXT NOT NULL REFERENCES clubs (guid) ON DELETE CASCADE,
  naam          TEXT NOT NULL,
  cat_code      TEXT,                       -- 'J16', afgeleid uit de GUID
  cat_label     TEXT,                       -- 'Heren Senioren', zoals de API het noemt
  volgen        INTEGER NOT NULL DEFAULT 1,
  actief        INTEGER NOT NULL DEFAULT 1,
  laatst_gezien TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_teams_club ON teams (club_guid, naam);

-- ---------------------------------------------------------------------------
-- matches: enkel THUISwedstrijden van teams die aangevinkt staan. Youth
-- Officials worden immers alleen thuis ingezet.
--   hash   : over datum, uur, thuis, uit en locatie — de velden waarvan een
--            wijziging opgevolgd moet worden
--   status : 'actief' of 'verdwenen' (nooit verwijderen, beschikbaarheden
--            hangen eraan)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  guid          TEXT PRIMARY KEY,
  wed_id        TEXT,
  seizoen       TEXT NOT NULL,              -- '2627'
  club_guid     TEXT NOT NULL REFERENCES clubs (guid) ON DELETE CASCADE,
  thuis_guid    TEXT NOT NULL,
  thuis_naam    TEXT NOT NULL,
  uit_guid      TEXT,
  uit_naam      TEXT NOT NULL,
  datum         TEXT NOT NULL,              -- 'YYYY-MM-DD'
  uur           TEXT NOT NULL,              -- 'HH:MM'
  locatie       TEXT,
  acc_guid      TEXT,                       -- locatie-GUID, betrouwbaarder dan de naam
  poule_naam    TEXT,
  cat_code      TEXT,                       -- van het thuisteam, gekopieerd bij de sync
  -- Scheidsrechters zoals Basketbal Vlaanderen ze aanduidt.
  --   off_aantal blijft altijd bewaard: de woensdagregel en de avondcontrole
  --   hebben alleen het aantal nodig.
  --   off_namen wordt gewist vanaf een dag na de wedstrijd; het gaat om namen
  --   van derden die we niet langer hoeven bij te houden dan nodig.
  off_namen     TEXT,                       -- JSON-array, of NULL na opkuis
  off_aantal    INTEGER NOT NULL DEFAULT 0,
  off_gewist    INTEGER NOT NULL DEFAULT 0,
  -- Staat deze wedstrijd in de aanduidingslijst, en waarom.
  --   'auto'     : categorie met auto_scope (U10/U12)
  --   'admin'    : een beheerder heeft ze aangeduid
  --   'woensdag' : de woensdagregel stelde vast dat Basketbal Vlaanderen er
  --                minder dan twee scheidsrechters op had staan
  -- scope_uit = 1 betekent: een beheerder heeft ze bewust weer uitgezet, en de
  -- automatische regels mogen ze niet opnieuw binnenhalen.
  scope         INTEGER NOT NULL DEFAULT 0,
  scope_reden   TEXT CHECK (scope_reden IN ('auto', 'admin', 'woensdag')),
  scope_op      TEXT,
  scope_uit     INTEGER NOT NULL DEFAULT 0,
  -- Een beheerder weet dat er twee scheidsrechters zijn terwijl het systeem van
  -- Basketbal Vlaanderen er nog geen toont. Puur een vlag: ze wijst niemand aan
  -- en verandert niets aan hoeveel officials er nodig zijn. Enige functie is de
  -- rode melding onderdrukken, want de situatie is in werkelijkheid in orde.
  -- Wordt automatisch gewist zodra de bond zelf twee refs invult.
  refs_bevestigd INTEGER NOT NULL DEFAULT 0,
  refs_bevestigd_door TEXT,
  refs_bevestigd_op   TEXT,
  -- Waar deze wedstrijd vandaan komt.
  --   'vbl'       : opgehaald bij Basketbal Vlaanderen
  --   'handmatig' : door een beheerder toegevoegd (oefenwedstrijd, toernooi)
  -- Handmatige wedstrijden worden door de synchronisatie met rust gelaten:
  -- ze staan niet in de API, dus zouden ze anders elke nacht als 'verdwenen'
  -- gemarkeerd worden.
  bron          TEXT NOT NULL DEFAULT 'vbl' CHECK (bron IN ('vbl', 'handmatig')),
  -- De eindstand, thuis-uit, bv. '63-92'. Alleen gevuld als de wedstrijd
  -- gespeeld is en Basketbal Vlaanderen ze doorgeeft. Puur ter info bij de
  -- wedstrijd zelf, telt nergens anders in mee.
  uitslag       TEXT,
  hash          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'actief' CHECK (status IN ('actief', 'verdwenen')),
  laatst_gezien TEXT NOT NULL DEFAULT (datetime('now')),
  aangemaakt    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_matches_datum ON matches (datum, uur);
CREATE INDEX IF NOT EXISTS idx_matches_team ON matches (thuis_guid, status);
CREATE INDEX IF NOT EXISTS idx_matches_club ON matches (club_guid, seizoen, status);
CREATE INDEX IF NOT EXISTS idx_matches_opkuis ON matches (off_gewist, datum);
CREATE INDEX IF NOT EXISTS idx_matches_scope ON matches (scope, datum, uur);
CREATE INDEX IF NOT EXISTS idx_matches_bron ON matches (bron, seizoen);


-- ---------------------------------------------------------------------------
-- assignments: de eigen aanduidingen. Een basketbalwedstrijd heeft in principe
-- twee scheidsrechters; hoeveel er nog gezocht worden is 2 min het aantal dat
-- Basketbal Vlaanderen al heeft aangeduid.
--
-- Vrijgeven verwijdert de rij niet meteen maar zet ze op 'vrijgegeven', zodat
-- zichtbaar blijft dat er iets veranderd is en de betrokkene verwittigd kan
-- worden. Bij een nieuwe toewijzing aan dezelfde persoon wordt de rij hergebruikt.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assignments (
  match_guid      TEXT NOT NULL REFERENCES matches (guid) ON DELETE CASCADE,
  user_email      TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'toegewezen'
                    CHECK (status IN ('toegewezen', 'vrijgegeven')),
  toegewezen_door TEXT NOT NULL,
  toegewezen_op   TEXT NOT NULL DEFAULT (datetime('now')),
  gewijzigd_op    TEXT,
  PRIMARY KEY (match_guid, user_email)
);

CREATE INDEX IF NOT EXISTS idx_assignments_user ON assignments (user_email, status);
CREATE INDEX IF NOT EXISTS idx_assignments_match ON assignments (match_guid, status);

-- ---------------------------------------------------------------------------
-- problemen: een Youth Official kan een toewijzing niet zelf ongedaan maken,
-- maar wel melden dat er iets mis is. De beheerder beslist.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS problemen (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_guid   TEXT NOT NULL REFERENCES matches (guid) ON DELETE CASCADE,
  user_email   TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  bericht      TEXT NOT NULL,
  gemeld_op    TEXT NOT NULL DEFAULT (datetime('now')),
  afgehandeld  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_problemen_open ON problemen (afgehandeld, gemeld_op);


-- ---------------------------------------------------------------------------
-- afgesloten_maanden: de momentopname per maand.
--
-- Afsluiten legt de bedragen vast. Zonder die vastlegging zou een vrijgave in
-- november het bedrag van oktober met terugwerkende kracht veranderen, nadat de
-- penningmeester al betaald heeft. Vandaar een kopie in plaats van een
-- berekening die elke keer opnieuw uit de aanduidingen komt.
--
-- Deze tabel bestaat ook om resets tegen te houden: zolang er een afgesloten
-- maand is, mag er niets gewist worden.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afgesloten_maanden (
  maand         TEXT PRIMARY KEY,          -- 'JJJJ-MM'
  seizoen       TEXT NOT NULL,
  afgesloten_op TEXT NOT NULL DEFAULT (datetime('now')),
  afgesloten_door TEXT NOT NULL,
  totaal_cent   INTEGER NOT NULL DEFAULT 0,
  aantal_officials INTEGER NOT NULL DEFAULT 0,
  verstuurd_op  TEXT,
  verstuurd_naar TEXT
);

-- ---------------------------------------------------------------------------
-- vergoeding_regels: één regel per official, per maand, per categorie.
--
-- soort 'wedstrijd' is werk in de afgesloten maand zelf. Soort 'correctie' is
-- een rechtzetting van een eerdere maand: die kan niet meer in het overzicht
-- van toen, dus komt ze in de eerstvolgende afsluiting terecht. Het veld
-- betreft_maand zegt over welke maand de correctie gaat.
--
-- aantal mag negatief zijn: een aanduiding die na de afsluiting is vrijgegeven,
-- levert een regel van -1 op.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vergoeding_regels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  maand         TEXT NOT NULL REFERENCES afgesloten_maanden (maand) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  naam          TEXT NOT NULL,             -- bewaard, niet opgezocht: een official
                                           -- kan later verwijderd of hernoemd zijn
  soort         TEXT NOT NULL DEFAULT 'wedstrijd'
                  CHECK (soort IN ('wedstrijd', 'correctie')),
  betreft_maand TEXT,                      -- enkel bij een correctie
  cat_code      TEXT NOT NULL,
  cat_label     TEXT,
  aantal        INTEGER NOT NULL,
  tarief_cent   INTEGER NOT NULL,
  bedrag_cent   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vergoeding_maand ON vergoeding_regels (maand, user_email);
CREATE INDEX IF NOT EXISTS idx_vergoeding_user ON vergoeding_regels (user_email, maand DESC);

-- ---------------------------------------------------------------------------
-- vergoeding_verwerkt: welke aanduidingen al in een afsluiting zijn opgenomen.
--
-- Zonder dit spoor kan een correctie niet bepaald worden: je weet dan niet of
-- een aanduiding al eerder is uitbetaald. De rij blijft bestaan ook nadat de
-- aanduiding is vrijgegeven — juist dan is ze nodig.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vergoeding_verwerkt (
  match_guid   TEXT NOT NULL,
  user_email   TEXT NOT NULL,
  maand        TEXT NOT NULL,              -- de maand waarin het is meegeteld
  cat_code     TEXT NOT NULL,
  tarief_cent  INTEGER NOT NULL,
  aantal       INTEGER NOT NULL DEFAULT 1, -- 1 of -1 na een correctie
  PRIMARY KEY (match_guid, user_email, maand)
);

CREATE INDEX IF NOT EXISTS idx_verwerkt_user ON vergoeding_verwerkt (user_email);



-- ---------------------------------------------------------------------------
-- ouder_kind: wie mag namens wie handelen.
--
-- Een aparte tabel en geen kolom op `users`, omdat een kind meerdere ouders kan
-- hebben (gescheiden ouders die allebei willen invullen) en een ouder meerdere
-- kinderen.
--
-- Het kind blijft een gewone rij in `users`, met alles wat daarbij hoort:
-- beschikbaarheden, aanduidingen, een eigen vergoedingsoverzicht. Krijgt het
-- later een eigen e-mailadres, dan hoeft er niets verplaatst te worden.
--
-- Enkel een beheerder maakt deze koppeling. Zou een ouder ze zelf kunnen
-- aanvragen, dan kan iemand een willekeurig kind aan zichzelf hangen.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ouder_kind (
  ouder_email TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  kind_email  TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  gekoppeld   TEXT NOT NULL DEFAULT (datetime('now')),
  door        TEXT NOT NULL,
  PRIMARY KEY (ouder_email, kind_email)
);

CREATE INDEX IF NOT EXISTS idx_ouder_kind_ouder ON ouder_kind (ouder_email);
CREATE INDEX IF NOT EXISTS idx_ouder_kind_kind ON ouder_kind (kind_email);


-- ---------------------------------------------------------------------------
-- volg_clubs: externe clubs waarvan een beheerder de bezetting wil zien,
-- los van de eigen club. Voor de aandachtspagina (V31): welke wedstrijden bij
-- ándere clubs weinig of geen scheidsrechters hebben.
--
-- Geen relatie met `clubs`: dat is de eigen club met de volledige
-- aanduidingsmodule erbij. Dit is een kale lijst, enkel om te weten welke
-- clubs de aparte synchronisatie moet ophalen.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS volg_clubs (
  guid        TEXT PRIMARY KEY,
  naam        TEXT,
  toegevoegd_door TEXT NOT NULL,
  toegevoegd  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- volg_wedstrijden: wedstrijden van de gevolgde clubs, met enkel wat nodig is
-- om te tonen waar het krap is.
--
-- Bewust een eigen, kleine tabel en niet hergebruik van `matches`: die tabel
-- is gebouwd rond de eigen aanduidingsmodule (scope, assignments,
-- beschikbaarheden) en dat past niet bij externe clubs waar YOAssist geen
-- enkele official aanduidt. Enkel VBL-scheidsrechters tellen hier, nooit
-- eigen aanduidingen — dat geldt zelfs voor de eigen club, moest die ook in
-- de volglijst staan, voor een consistente telling.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS volg_wedstrijden (
  guid        TEXT PRIMARY KEY,
  club_guid   TEXT NOT NULL REFERENCES volg_clubs (guid) ON DELETE CASCADE,
  club_naam   TEXT,
  thuis_naam  TEXT NOT NULL,
  uit_naam    TEXT NOT NULL,
  datum       TEXT NOT NULL,
  uur         TEXT NOT NULL,
  cat_code    TEXT,
  vbl_aantal  INTEGER NOT NULL DEFAULT 0,
  -- Enkel gevuld bij precies één scheidsrechter: dan is een naam bruikbare
  -- info (wie te bereiken om aan te vullen). Bij nul is er niemand om te
  -- noemen; bij twee of meer toont de pagina de wedstrijd toch al niet.
  vbl_naam    TEXT,
  laatst_gezien TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_volg_wedstrijden_datum ON volg_wedstrijden (datum, uur);
CREATE INDEX IF NOT EXISTS idx_volg_wedstrijden_club ON volg_wedstrijden (club_guid);

-- ---------------------------------------------------------------------------
-- berichten: wat er naar een gebruiker is gestuurd.
--
-- Een samenvatting, geen kopie van de mailtekst. Die tekst staat al in de
-- templates; hier bewaren zou hem dubbel opslaan en verouderd laten raken zodra
-- een wedstrijd verschuift. De verwijzing naar de wedstrijd blijft wel kloppen.
--
-- Enkel wat effectief verstuurd is. Mislukte pogingen horen in het logboek, niet
-- in het overzicht van een official — die kan er toch niets mee.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS berichten (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email  TEXT NOT NULL,
  soort       TEXT NOT NULL,        -- aanduiding, vrijgave, herinnering, probleem, nieuws
  titel       TEXT NOT NULL,
  tekst       TEXT,                 -- korte samenvatting, niet de volledige mail
  match_guid  TEXT,
  verstuurd   TEXT NOT NULL DEFAULT (datetime('now')),
  kanalen     TEXT,                 -- 'mail', 'push' of 'mail,push'
  -- Pas gezet bij het individueel aanklikken van een bericht, niet automatisch
  -- bij het openen of sluiten van het paneel — zo kan iemand eerst scannen
  -- zonder dat de stipjes al verdwijnen.
  gelezen_op  TEXT
);

CREATE INDEX IF NOT EXISTS idx_berichten_user ON berichten (user_email, id DESC);
CREATE INDEX IF NOT EXISTS idx_berichten_tijd ON berichten (verstuurd);

-- ---------------------------------------------------------------------------
-- mededelingen: het belangrijke nieuws.
--
-- Eén actieve rij tegelijk; een nieuwe vervangt de vorige als banner. De oude
-- blijft wel in `berichten` staan bij wie ze toen kreeg — daarom een aparte
-- tabel en geen instelling.
--
-- `geldig_tot` is een echt veld en geen aan/uit-vlag: na dat moment verdwijnt
-- de banner vanzelf, ook zonder dat iemand ze wegklikte.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mededelingen (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tekst       TEXT NOT NULL,
  link        TEXT,
  link_tekst  TEXT,
  geldig_tot  TEXT NOT NULL,
  gezet_door  TEXT NOT NULL,
  gezet_op    TEXT NOT NULL DEFAULT (datetime('now')),
  actief      INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_mededeling_actief ON mededelingen (actief, geldig_tot);

-- ---------------------------------------------------------------------------
-- mededeling_gezien: wie welke mededeling heeft weggeklikt.
--
-- Per persoon, want wegklikken is een persoonlijke handeling. Verdwijnt mee met
-- de mededeling zelf.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mededeling_gezien (
  mededeling_id INTEGER NOT NULL REFERENCES mededelingen (id) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  weggeklikt_op TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mededeling_id, user_email)
);

-- ---------------------------------------------------------------------------
-- logboek: één chronologisch spoor van alles wat er gebeurt.
--
-- Bewust één tabel en geen aparte per onderwerp. Een beheerder die zich afvraagt
-- waarom een wedstrijd er anders bij staat, wil in één lijst kunnen zien dat de
-- synchronisatie het uur wijzigde én dat iemand daarna de aanduiding vrijgaf.
-- Twee tabellen zouden bij elke vraag samengevoegd moeten worden.
--
--   categorie : 'wedstrijd' | 'aanduiding' | 'beheer'
--   soort     : wat er gebeurde, bv. 'nieuw', 'gewijzigd', 'verdwenen',
--               'toegewezen', 'vrijgegeven', 'probleem', 'sync', 'teams',
--               'club', 'seizoen', 'bulk'
--   wie       : e-mailadres van wie het deed, of 'systeem' voor de cron
--   match_guid: leeg bij beheeracties die niet over één wedstrijd gaan
--
-- afgehandeld blijft bestaan voor wedstrijdwijzigingen die opvolging vragen;
-- beheeracties staan er meteen op 1, want daar valt niets aan af te handelen.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS logboek (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  categorie    TEXT NOT NULL CHECK (categorie IN ('wedstrijd', 'aanduiding', 'beheer')),
  soort        TEXT NOT NULL,
  match_guid   TEXT,
  wie          TEXT NOT NULL DEFAULT 'systeem',
  veld         TEXT,
  oud          TEXT,
  nieuw        TEXT,
  vastgesteld  TEXT NOT NULL DEFAULT (datetime('now')),
  afgehandeld  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_logboek_tijd ON logboek (id DESC);
CREATE INDEX IF NOT EXISTS idx_logboek_open ON logboek (afgehandeld, categorie);
CREATE INDEX IF NOT EXISTS idx_logboek_match ON logboek (match_guid, id DESC);

-- ---------------------------------------------------------------------------
-- availability: door de Youth Official zelf ingevuld.
-- Geen rij = nog niet geantwoord. Dat is bewust iets anders dan 'nee'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS availability (
  user_email  TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  match_guid  TEXT NOT NULL REFERENCES matches (guid) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('ja', 'nee')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_email, match_guid)
);

CREATE INDEX IF NOT EXISTS idx_availability_match ON availability (match_guid, status);

-- ---------------------------------------------------------------------------
-- sync_runs: logboek van elke synchronisatie, geslaagd of niet.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  gestart           TEXT NOT NULL DEFAULT (datetime('now')),
  geeindigd         TEXT,
  bron              TEXT NOT NULL,          -- 'cron' | 'handmatig'
  status            TEXT NOT NULL,          -- 'ok' | 'mislukt' | 'deels'
  aantal_gevonden   INTEGER NOT NULL DEFAULT 0,
  aantal_nieuw      INTEGER NOT NULL DEFAULT 0,
  aantal_gewijzigd  INTEGER NOT NULL DEFAULT 0,
  aantal_verdwenen  INTEGER NOT NULL DEFAULT 0,
  boodschap         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_recent ON sync_runs (gestart DESC);
