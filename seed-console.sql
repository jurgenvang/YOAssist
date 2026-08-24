-- Pas de adressen aan vóór je dit uitvoert.
-- Zet jezelf als eerste admin, anders raak je niet in het beheermenu.
-- club_guid blijft NULL tot je de club via het beheermenu hebt toegevoegd.

INSERT OR REPLACE INTO users (email, naam, is_admin, profiel, club_guid, actief) VALUES ('jij@uw-club.be', 'Jouw Naam', 1, 'YO+', NULL, 1);

INSERT OR REPLACE INTO users (email, naam, is_admin, profiel, club_guid, actief) VALUES ('jan@uw-club.be', 'Jan Peeters', 0, 'YO', NULL, 1);

INSERT OR REPLACE INTO users (email, naam, is_admin, profiel, club_guid, actief) VALUES ('marie@uw-club.be', 'Marie Bos', 0, 'YO+', NULL, 1);
