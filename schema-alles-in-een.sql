DROP TABLE IF EXISTS volg_wedstrijden;
DROP TABLE IF EXISTS volg_clubs;
DROP TABLE IF EXISTS ouder_kind;
DROP TABLE IF EXISTS mededeling_gezien;
DROP TABLE IF EXISTS mededelingen;
DROP TABLE IF EXISTS berichten;
DROP TABLE IF EXISTS vergoeding_verwerkt;
DROP TABLE IF EXISTS vergoeding_regels;
DROP TABLE IF EXISTS afgesloten_maanden;
DROP TABLE IF EXISTS assignments;
DROP TABLE IF EXISTS problemen;
DROP TABLE IF EXISTS availability;
DROP TABLE IF EXISTS logboek;
DROP TABLE IF EXISTS match_changes;
DROP TABLE IF EXISTS sync_runs;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS push_abonnementen;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS clubs;
DROP TABLE IF EXISTS categorieen;
DROP TABLE IF EXISTS settings;

CREATE TABLE IF NOT EXISTS settings (
  sleutel  TEXT PRIMARY KEY,
  waarde   TEXT NOT NULL,
  gewijzigd TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('seizoen_start_jaar', '2026');
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('mail_afzender', '');
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('mail_afzender_naam', 'YOAssist');
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('facturatie_ontvangers', '');
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('aanmeld_methodes', 'pin');
INSERT OR IGNORE INTO settings (sleutel, waarde) VALUES ('extern_namen', 'initialen');
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
CREATE TABLE IF NOT EXISTS clubs (
  guid        TEXT PRIMARY KEY,
  naam        TEXT,
  actief      INTEGER NOT NULL DEFAULT 1,
  toegevoegd  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  email       TEXT PRIMARY KEY,
  voornaam    TEXT NOT NULL,
  achternaam  TEXT NOT NULL,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  profiel     TEXT NOT NULL DEFAULT 'YO' CHECK (profiel IN ('YO', 'YO+')),
  club_guid   TEXT REFERENCES clubs (guid) ON DELETE SET NULL,
  gsm         TEXT,
  actief      INTEGER NOT NULL DEFAULT 1,
  kanaal_mail INTEGER NOT NULL DEFAULT 1,
  kanaal_push INTEGER NOT NULL DEFAULT 0,
  herinner_avond   INTEGER NOT NULL DEFAULT 1,
  herinner_ochtend INTEGER NOT NULL DEFAULT 1,
  verborgen_tabs TEXT NOT NULL DEFAULT 'log,aandacht',
  gsm_delen   INTEGER NOT NULL DEFAULT 1,
  agenda_sleutel TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_naam
  ON users (achternaam COLLATE NOCASE, voornaam COLLATE NOCASE);
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
  refs_bevestigd INTEGER NOT NULL DEFAULT 0,
  refs_bevestigd_door TEXT,
  refs_bevestigd_op   TEXT,
  bron          TEXT NOT NULL DEFAULT 'vbl' CHECK (bron IN ('vbl', 'handmatig')),
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
CREATE TABLE IF NOT EXISTS problemen (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  match_guid   TEXT NOT NULL REFERENCES matches (guid) ON DELETE CASCADE,
  user_email   TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  bericht      TEXT NOT NULL,
  gemeld_op    TEXT NOT NULL DEFAULT (datetime('now')),
  afgehandeld  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_problemen_open ON problemen (afgehandeld, gemeld_op);
CREATE TABLE IF NOT EXISTS afgesloten_maanden (
  maand         TEXT PRIMARY KEY,
  seizoen       TEXT NOT NULL,
  afgesloten_op TEXT NOT NULL DEFAULT (datetime('now')),
  afgesloten_door TEXT NOT NULL,
  totaal_cent   INTEGER NOT NULL DEFAULT 0,
  aantal_officials INTEGER NOT NULL DEFAULT 0,
  verstuurd_op  TEXT,
  verstuurd_naar TEXT
);
CREATE TABLE IF NOT EXISTS vergoeding_regels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  maand         TEXT NOT NULL REFERENCES afgesloten_maanden (maand) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  naam          TEXT NOT NULL,
  soort         TEXT NOT NULL DEFAULT 'wedstrijd'
                  CHECK (soort IN ('wedstrijd', 'correctie')),
  betreft_maand TEXT,
  cat_code      TEXT NOT NULL,
  cat_label     TEXT,
  aantal        INTEGER NOT NULL,
  tarief_cent   INTEGER NOT NULL,
  bedrag_cent   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vergoeding_maand ON vergoeding_regels (maand, user_email);
CREATE INDEX IF NOT EXISTS idx_vergoeding_user ON vergoeding_regels (user_email, maand DESC);
CREATE TABLE IF NOT EXISTS vergoeding_verwerkt (
  match_guid   TEXT NOT NULL,
  user_email   TEXT NOT NULL,
  maand        TEXT NOT NULL,
  cat_code     TEXT NOT NULL,
  tarief_cent  INTEGER NOT NULL,
  aantal       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (match_guid, user_email, maand)
);
CREATE INDEX IF NOT EXISTS idx_verwerkt_user ON vergoeding_verwerkt (user_email);
CREATE TABLE IF NOT EXISTS ouder_kind (
  ouder_email TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  kind_email  TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  gekoppeld   TEXT NOT NULL DEFAULT (datetime('now')),
  door        TEXT NOT NULL,
  PRIMARY KEY (ouder_email, kind_email)
);
CREATE INDEX IF NOT EXISTS idx_ouder_kind_ouder ON ouder_kind (ouder_email);
CREATE INDEX IF NOT EXISTS idx_ouder_kind_kind ON ouder_kind (kind_email);
CREATE TABLE IF NOT EXISTS volg_clubs (
  guid        TEXT PRIMARY KEY,
  naam        TEXT,
  toegevoegd_door TEXT NOT NULL,
  toegevoegd  TEXT NOT NULL DEFAULT (datetime('now'))
);
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
  vbl_naam    TEXT,
  laatst_gezien TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_volg_wedstrijden_datum ON volg_wedstrijden (datum, uur);
CREATE INDEX IF NOT EXISTS idx_volg_wedstrijden_club ON volg_wedstrijden (club_guid);
CREATE TABLE IF NOT EXISTS berichten (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email  TEXT NOT NULL,
  soort       TEXT NOT NULL,
  titel       TEXT NOT NULL,
  tekst       TEXT,
  match_guid  TEXT,
  verstuurd   TEXT NOT NULL DEFAULT (datetime('now')),
  kanalen     TEXT,
  gelezen_op  TEXT
);
CREATE INDEX IF NOT EXISTS idx_berichten_user ON berichten (user_email, id DESC);
CREATE INDEX IF NOT EXISTS idx_berichten_tijd ON berichten (verstuurd);
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
CREATE TABLE IF NOT EXISTS mededeling_gezien (
  mededeling_id INTEGER NOT NULL REFERENCES mededelingen (id) ON DELETE CASCADE,
  user_email    TEXT NOT NULL,
  weggeklikt_op TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mededeling_id, user_email)
);
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
CREATE TABLE IF NOT EXISTS availability (
  user_email  TEXT NOT NULL REFERENCES users (email) ON DELETE CASCADE,
  match_guid  TEXT NOT NULL REFERENCES matches (guid) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('ja', 'nee')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_email, match_guid)
);
CREATE INDEX IF NOT EXISTS idx_availability_match ON availability (match_guid, status);
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
