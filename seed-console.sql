-- YOAssist — jouw beheerders.
-- Beide accounts hebben is_admin = 1 en profiel YO+, dus ze zien zowel het
-- beheermenu als de wedstrijdlijst van alle YO+-ploegen.
-- club_guid staat nog op NULL: koppelen doe je zodra de club is toegevoegd.

INSERT OR REPLACE INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid, actief) VALUES ('jurgenvang@gmail.com', 'Jurgen', 'van Geijstelen', 1, 'YO+', NULL, 1);

INSERT OR REPLACE INTO users (email, voornaam, achternaam, is_admin, profiel, club_guid, actief) VALUES ('fluppevanmeerbeeck@gmail.com', 'Fluppe', 'Van Meerbeeck', 1, 'YO+', NULL, 1);
