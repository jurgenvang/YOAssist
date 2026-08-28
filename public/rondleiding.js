/**
 * De stappen van de rondleiding.
 *
 * Twee reeksen, want twee verhalen. Een Youth Official wil weten wat er van hem
 * verwacht wordt; een beheerder wil weten hoe hij een weekend rond krijgt. Eén
 * gedeelde reeks zou voor allebei half kloppen.
 *
 * Een stap met `opent` doet eerst een menu of paneel open. Zonder dat zou de
 * rondleiding naar een verborgen element wijzen en de stap overslaan — en juist
 * de meldingen, die achter twee klikken zitten, vindt niemand vanzelf.
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
      titel: 'Drie delen',
      tekst:
        'Bovenaan waarvoor je bent aangeduid, dan wat nog een antwoord vraagt, ' +
        'en onderaan wat je al beantwoord hebt. Ben je aangeduid en lukt het toch ' +
        'niet, meld dat dan bij die wedstrijd — niet met een berichtje aan je ' +
        'trainer, want dan komt het niet bij de juiste persoon terecht.',
      plaats: 'onder',
    },
    {
      doel: '#balk-info',
      titel: 'Alles over jou zit hier',
      tekst:
        'Tik op je naam. Daarachter vind je je voorkeuren, je vergoeding, deze ' +
        'rondleiding en de handleiding.',
      plaats: 'onder',
    },
    {
      doel: '[data-menu="voorkeuren"]',
      titel: 'Mijn voorkeuren',
      tekst:
        'Hier stel je in hoe je bericht wil krijgen en of je herinneringen wil ' +
        'voor wedstrijden die je fluit.',
      plaats: 'onder',
      opent: 'menu',
    },
    {
      doel: '[data-voorkeur="push"]',
      titel: 'Meldingen op je gsm',
      tekst:
        'Zet dit aan en je krijgt een melding op je toestel in plaats van alleen ' +
        'een mail. Op een iPhone moet je YOAssist eerst aan je beginscherm ' +
        'toevoegen: dat staat er dan bij uitgelegd.',
      plaats: 'boven',
      opent: 'voorkeuren',
    },
    {
      doel: '[data-voorkeur="herinnerAvond"]',
      titel: 'Herinneringen',
      tekst:
        'De avond ervoor en de ochtend zelf krijg je een herinnering voor de ' +
        'wedstrijden die je fluit. Wil je die niet, zet ze hier af.',
      plaats: 'boven',
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
        'wedstrijd er zelf bij. Je kunt ze ook handmatig toevoegen of weglaten.',
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
      doel: '[data-menu="beheer"]',
      titel: 'Beheer',
      tekst:
        'Clubs en ploegen, gebruikers, synchronisatie, vrijgeven, backup en ' +
        'opnieuw beginnen. Hier stuur je ook de welkomstmail naar nieuwe ' +
        'officials, met uitleg hoe ze de app installeren.',
      plaats: 'onder',
      opent: 'menu',
    },
    {
      doel: '[data-menu="clubgeld"]',
      titel: 'Vergoedingen Club',
      tekst:
        'Een maand afsluiten kan vanaf de eerste dag van de volgende maand. Dat ' +
        'legt de bedragen vast en stuurt iedereen zijn overzicht.',
      plaats: 'onder',
      opent: 'menu',
    },
    {
      doel: '[data-menu="alsyo"]',
      titel: 'Kijken als official',
      tekst:
        'Wil je controleren wat je officials zien? Zet dit aan en de app toont ' +
        'wat een gewone YO ziet. Een balk bovenaan herinnert je eraan.',
      plaats: 'onder',
      opent: 'menu',
    },
  ],
};
