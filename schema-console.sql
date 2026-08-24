-- YOAssist schema, klaar om in de D1-console te plakken.
-- Geen commentaar binnenin, geen PRAGMA: daar struikelt de console over.
-- Werkt de console alleen met één statement tegelijk, plak dan blok per blok.

-- ===== BLOK 1 van 8 =====
CREATE TABLE IF NOT EXISTS settings (
  sleutel  TEXT PRIMARY KEY,
  waarde   TEXT NOT NULL,
  gewijzigd TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('seizoen_start_jaar', '2026');

-- ===== BLOK 2 van 8 =====
CREATE TABLE IF NOT EXISTS clubs (
  guid        TEXT PRIMARY KEY,
  naam        TEXT,
  actief      INTEGER NOT NULL DEFAULT 1,
  toegevoegd  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== BLOK 3 van 8 =====
CREATE TABLE IF NOT EXISTS users (
  email      TEXT PRIMARY KEY,
  naam       TEXT NOT NULL,
  is_admin   INTEGER NOT NULL DEFAULT 0,
  profiel    TEXT NOT NULL DEFAULT 'YO' CHECK (profiel IN ('YO', 'YO+')),
  club_guid  TEXT REFERENCES clubs (guid) ON DELETE SET NULL,
  gsm        TEXT,
  actief     INTEGER NOT NULL DEFAULT 1
);

-- ===== BLOK 4 van 8 =====
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

-- ===== BLOK 5 van 8 =====
CREATE TABLE IF NOT EXISTS matches (
  guid          TEXT PRIMARY KEY,
  wed_id        TEXT,
  seizoen       TEXT NOT NULL,
  club_guid     TEXT NOT NULL REFERENCES clubs (guid) ON DELETE CASCADE,
  thuis_guid    TEXT NOT NULL,
  thuis_naam    TEXT NOT NULL,
  uit_guid      TEXT,
  uit_naam      TEXT NOT NULL,
  datum         TEXT NOT NULL,
  uur           TEXT NOT NULL,
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

-- ===== BLOK 6 van 8 =====
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

-- ===== BLOK 7 van 8 =====
CREATE TABLE IF NOT EXISTS availability (
  user_email  TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  match_guid  TEXT NOT NULL REFERENCES matches (guid) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('ja', 'nee')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_email, match_guid)
);

CREATE INDEX IF NOT EXISTS idx_availability_match ON availability (match_guid, status);

-- ===== BLOK 8 van 8 =====
CREATE TABLE IF NOT EXISTS sync_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  gestart           TEXT NOT NULL DEFAULT (datetime('now')),
  geeindigd         TEXT,
  bron              TEXT NOT NULL,
  status            TEXT NOT NULL,
  aantal_gevonden   INTEGER NOT NULL DEFAULT 0,
  aantal_nieuw      INTEGER NOT NULL DEFAULT 0,
  aantal_gewijzigd  INTEGER NOT NULL DEFAULT 0,
  aantal_verdwenen  INTEGER NOT NULL DEFAULT 0,
  boodschap         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_recent ON sync_runs (gestart DESC);
