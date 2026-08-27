/**
 * De stappen van de rondleiding.
 *
 * Twee reeksen, want twee verhalen. Een Youth Official wil weten wat er van hem
 * verwacht wordt; een beheerder wil weten hoe hij een weekend rond krijgt. Eén
 * gedeelde reeks zou voor allebei half kloppen.
 *
 * Apart van de weergavecode gehouden zodat een test kan controleren dat elk
 * doelelement bestaat. Een pijl naar een verdwenen knop gaat anders stil kapot.
 */

window.YOASSIST_RONDLEIDING = {
  /** Voor iedereen. Volgorde: wat er van je verwacht wordt, dan de rest. */
  official: [
    {
      doel: '.wed',
      titel: 'Zeg of je kunt',
      tekst:
        'Hier staan de thuiswedstrijden die jij kunt fluiten. Antwoord bij elke ' +
        'wedstrijd — ook als het nee is. Dan weet de beheerder waar hij aan toe is ' +
        'en hoeft hij niemand achterna te bellen.',
      plaats: 'onder',
    },
    {
      doel: '.wed-acties',
      titel: 'Beschikbaar is nog geen aanduiding',
      tekst:
        'Ja zeggen betekent dat je zou kunnen, niet dat je moet komen. De ' +
        'beheerder kiest daarna wie er effectief fluit. Ben je aangeduid, dan ' +
        'krijg je daar bericht van en verschijnt de wedstrijd bovenaan.',
      plaats: 'boven',
    },
    {
      doel: '.groep-kop',
      titel: 'Wat je zeker moet fluiten',
      tekst:
        'De lijst staat in drie delen: waarvoor je bent aangeduid, wat nog een ' +
        'antwoord vraagt, en wat je al beantwoord hebt. Een kop aantikken klapt ' +
        'dat deel open of dicht.',
      plaats: 'onder',
    },
    {
      doel: '#balk-info',
      titel: 'Kun je toch niet?',
      tekst:
        'Ben je aangeduid en lukt het niet meer, meld dat dan in de app bij die ' +
        'wedstrijd — niet met een berichtje aan je trainer. Hier bij je naam stel ' +
        'je ook in hoe je bericht wil krijgen: per mail of met meldingen op je gsm. ' +
        'Op een iPhone moet je de app daarvoor eerst aan je beginscherm toevoegen.',
      plaats: 'onder',
    },
  ],

  /** Voor beheerders. Het verhaal is: hoe krijg ik een weekend rond. */
  beheerder: [
    {
      doel: '#tab-club',
      titel: 'Hier ligt het werk',
      tekst:
        'Het cluboverzicht toont de twee eerstvolgende weekends. Bovenaan staat ' +
        'wat aandacht vraagt: wedstrijden zonder genoeg officials of zonder ' +
        'iemand die beschikbaar is.',
      plaats: 'onder',
    },
    {
      doel: '#tab-club',
      titel: 'Wie er in de lijst komt',
      tekst:
        'U10 en U12 staan er automatisch in. Vanaf U14 duidt Basketbal Vlaanderen ' +
        'zelf scheidsrechters aan; komt er woensdag geen tweede, dan zet de app de ' +
        'wedstrijd er zelf bij. Je kunt ze ook handmatig toevoegen of net weglaten.',
      plaats: 'onder',
    },
    {
      doel: '#tab-log',
      titel: 'Wat er gebeurd is',
      tekst:
        'Elke aanduiding, elke wijziging aan de kalender en elke beheeractie komt ' +
        'hier terecht. Handig als je je afvraagt waarom een wedstrijd er anders ' +
        'bij staat dan gisteren.',
      plaats: 'onder',
    },
    {
      doel: '#balk-info',
      titel: 'Beheer en vergoedingen',
      tekst:
        'Achter je naam: Beheer voor clubs, ploegen, gebruikers en synchronisatie. ' +
        'Vergoedingen club om een maand af te sluiten — dat kan vanaf de eerste ' +
        'dag van de volgende maand en legt de bedragen vast.',
      plaats: 'onder',
    },
  ],
};
