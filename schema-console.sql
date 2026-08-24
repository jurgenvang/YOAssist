-- YOAssist schema, klaar om in de D1-console te plakken.
-- Geen commentaar binnenin, geen PRAGMA: daar struikelt de console over.
-- Werkt de console alleen met een statement tegelijk, plak dan blok per blok.

-- ===== BLOK 1 van 11 =====
CREATE TABLE IF NOT EXISTS settings (
  sleutel  TEXT PRIMARY KEY,
  waarde   TEXT NOT NULL,
  gewijzigd TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('seizoen_start_jaar', '2026');

-- ===== BLOK 2 van 11 =====
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

-- ===== BLOK 3 van 11 =====
CREATE TABLE IF NOT EXISTS clubs (
  guid        TEXT PRIMARY KEY,
  naam        TEXT,
  actief      INTEGER NOT NULL DEFAULT 1,
  toegevoegd  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===== BLOK 4 van 11 =====
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

CREATE INDEX IF NOT EXISTS idx_users_naam
  ON users (achternaam COLLATE NOCASE, voornaam COLLATE NOCASE);

-- ===== BLOK 5 van 11 =====
CREATE TABLE IF NOT EXISTS teams (
  guid          TEXT PRIMARY KEY,
  club_guid     TEXT NOT NULL REFERENCES clubs (guid) ON DELETE CASCADE,
  naam          TEXT NOT NULL,
  cat_code      TEXT,
  cat_label     TEXT,
  volgen        INTEGER NOT NULL DEFAULT 1,
  actief        INTEGER NOT NULL DEFAULT 1,
  laatst_gezien TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_teams_club ON teams (club_guid, naam);

-- ===== BLOK 6 van 11 =====
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
  acc_guid      TEXT,
  poule_naam    TEXT,
  cat_code      TEXT,
  off_namen     TEXT,
  off_aantal    INTEGER NOT NULL DEFAULT 0,
  off_gewist    INTEGER NOT NULL DEFAULT 0,
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

-- ===== BLOK 7 van 11 =====
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

-- ===== BLOK 8 van 11 =====
CREATE TABLE IF NOT EXISTS problemen (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_guid   TEXT NOT NULL REFERENCES matches (guid) ON DELETE CASCADE,
  user_email   TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  bericht      TEXT NOT NULL,
  gemeld_op    TEXT NOT NULL DEFAULT (datetime('now')),
  afgehandeld  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_problemen_open ON problemen (afgehandeld, gemeld_op);

-- ===== BLOK 9 van 11 =====
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

-- ===== BLOK 10 van 11 =====
CREATE TABLE IF NOT EXISTS availability (
  user_email  TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  match_guid  TEXT NOT NULL REFERENCES matches (guid) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('ja', 'nee')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_email, match_guid)
);

CREATE INDEX IF NOT EXISTS idx_availability_match ON availability (match_guid, status);

-- ===== BLOK 11 van 11 =====
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
