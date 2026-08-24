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
  actief      INTEGER NOT NULL DEFAULT 1
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
-- match_changes: audittrail van wat de synchronisatie vaststelde. Wat er met
-- deze regels moet gebeuren, wordt later ingevuld — voorlopig enkel loggen.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_changes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_guid   TEXT NOT NULL,
  soort        TEXT NOT NULL CHECK (soort IN ('nieuw', 'gewijzigd', 'verdwenen')),
  veld         TEXT,
  oud          TEXT,
  nieuw        TEXT,
  vastgesteld  TEXT NOT NULL DEFAULT (datetime('now')),
  afgehandeld  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_changes_open ON match_changes (afgehandeld, vastgesteld);

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
