-- YOAssist — beschikbaarheden en aanduidingen voor Youth Officials
-- D1 (SQLite). E-mailadressen en GUID's altijd genormaliseerd opgeslagen:
-- e-mail in lowercase, GUID exact zoals Basketbal Vlaanderen ze teruggeeft.

PRAGMA foreign_keys = ON;

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
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  naam       TEXT NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  profiel    TEXT NOT NULL DEFAULT 'YO' CHECK (profiel IN ('YO', 'YO+')),
  club_guid  TEXT REFERENCES clubs (guid) ON DELETE SET NULL,
  gsm        TEXT,
  actief     INTEGER NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- teams: opgehaald bij Basketbal Vlaanderen per club.
--   yo / yo_plus : voor welk profiel moeten hier aanduidingen gebeuren.
--                  yo = 1 impliceert yo_plus = 1 (afgedwongen in de code én hier).
--   actief       : stond dit team in de laatste opgehaalde teamlijst
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  guid          TEXT PRIMARY KEY,
  club_guid     TEXT NOT NULL REFERENCES clubs (guid) ON DELETE CASCADE,
  naam          TEXT NOT NULL,
  yo            INTEGER NOT NULL DEFAULT 0,
  yo_plus       INTEGER NOT NULL DEFAULT 0,
  actief        INTEGER NOT NULL DEFAULT 1,
  laatst_gezien TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (yo = 0 OR yo_plus = 1)
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
  poule_naam    TEXT,
  hash          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'actief' CHECK (status IN ('actief', 'verdwenen')),
  laatst_gezien TEXT NOT NULL DEFAULT (datetime('now')),
  aangemaakt    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_matches_datum ON matches (datum, uur);
CREATE INDEX IF NOT EXISTS idx_matches_team ON matches (thuis_guid, status);
CREATE INDEX IF NOT EXISTS idx_matches_club ON matches (club_guid, seizoen, status);

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
