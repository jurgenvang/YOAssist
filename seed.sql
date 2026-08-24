-- Pas de adressen aan vóór je dit uitvoert. Zet jezelf als eerste admin,
-- anders raak je niet in het beheermenu.
--
-- club_guid mag voorlopig NULL blijven: je koppelt gebruikers aan een club
-- zodra je die club via het beheermenu hebt toegevoegd. Zonder club ziet een
-- YO geen wedstrijden — de app zegt dat dan ook met zoveel woorden.

INSERT OR REPLACE INTO users (email, naam, is_admin, profiel, club_guid, actief) VALUES
  ('jij@uw-club.be',        'Jouw Naam',   1, 'YO+', NULL, 1),
  ('jan@uw-club.be',        'Jan Peeters', 0, 'YO',  NULL, 1),
  ('marie@uw-club.be',      'Marie Bos',   0, 'YO+', NULL, 1);

-- Nadat je de club hebt toegevoegd in het beheermenu, koppel je de gebruikers:
--   UPDATE users SET club_guid = 'BVBL1053';
