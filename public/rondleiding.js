/**
 * De stappen van de rondleiding.
 *
 * Apart van de weergave gehouden zodat een test kan controleren dat elk
 * doelelement ook echt in de interface bestaat. Een pijl die naar een
 * verdwenen knop wijst, gaat anders stil kapot: niemand merkt het tot een
 * nieuwe gebruiker zich afvraagt waarom er een pijl in het luchtledige hangt.
 *
 * Dit bestand wordt niet door de Worker geladen maar door de browser, als
 * gewoon script naast index.html. Het staat los omdat een lijst met teksten
 * niet thuishoort tussen de logica.
 */

window.YOASSIST_RONDLEIDING = [
  // ---- Voor iedereen ------------------------------------------------------
  {
    doel: '#hoofd',
    titel: 'Je wedstrijden',
    tekst:
      'Hier staan de thuiswedstrijden waarvoor jij aan de tafel kunt staan, ' +
      'gegroepeerd per maand. Bovenaan zie je hoeveel er nog te beantwoorden zijn.',
    plaats: 'onder',
  },
  {
    doel: '.wed-acties',
    titel: 'Beschikbaar of niet',
    tekst:
      'Tik op een van de twee knoppen. Nog eens op dezelfde knop tikken wist je ' +
      'antwoord, voor als je je vergist. Ben je aangeduid, dan verdwijnen de knoppen ' +
      'en kun je enkel nog een probleem melden.',
    plaats: 'boven',
    optioneel: true,
  },
  {
    doel: '#voorkeur-knop',
    titel: 'Je voorkeuren',
    tekst:
      'Hier stel je in hoe je bericht wil krijgen: per e-mail, met meldingen op je ' +
      'toestel, of allebei. Ook de herinneringen voor wedstrijden die je fluit.',
    plaats: 'onder',
  },

  // ---- Enkel voor beheerders ---------------------------------------------
  {
    doel: '#tab-club',
    titel: 'Cluboverzicht',
    tekst:
      'Alle thuiswedstrijden van de komende twee weekends, met wie er beschikbaar is ' +
      'en wie er al aangeduid staat. De cijfers bovenaan zijn tegelijk filters.',
    plaats: 'onder',
    enkelAdmin: true,
  },
  {
    doel: '#tab-log',
    titel: 'Logboek',
    tekst:
      'Alles wat er gebeurt komt hier terecht: gewijzigde wedstrijden, aanduidingen, ' +
      'beheeracties. Handig als je je afvraagt waarom iets er anders bij staat.',
    plaats: 'onder',
    enkelAdmin: true,
  },
  {
    doel: '#menu-knop',
    titel: 'Beheer',
    tekst:
      'Achter de drie puntjes: clubs en ploegen, gebruikers, mailinstellingen, ' +
      'synchronisatie en vrijgeven. Alles wat over de club gaat in plaats van over jou.',
    plaats: 'onder',
    enkelAdmin: true,
  },
];
