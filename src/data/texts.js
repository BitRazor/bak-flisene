// Norwegian text shown on things in the room. Every fact carries its source and the date it was read (kontor/claims.md,
// research/). Company details were checked 2026-10-19 (research/company.md). Company figures carry their date.
// Voice: a proud craftsperson, plain bokmål, dry Bergen humour, never salesy (concept rule 10).
import { PRICE_LEVEL } from './prices.js';

export const COMPANY = {
  name: 'Straume Våtrom AS',
  tagline: 'Kvalitet og trygghet',
  intro: 'Vi totalrehabiliterer bad og vaskerom i Bergen, Øygarden og Askøy, fra første befaring til ferdig bad.',
  // The site's six labels under its own heading (research/company.md section 5). Labels only: no terms are claimed.
  promisesHeading: 'Hvorfor velge Straume Våtrom?',
  promises: [
    'Tetthetsgaranti',
    'Fast pris og ferdigstillelsesdato',
    'Godkjent våtromsbedrift',
    'Riktig verktøy og kunnskap',
    'Alle fag under ett tak',
    'Alltid dokumentert arbeid',
  ],
  credentialsHeading: 'Godkjenninger',
  // The safe wording of research/company.md 2d: FFV lists three trades (tiling is not one of them); the master
  // register lists carpentry.
  credentials: [
    'Godkjent våtromsbedrift (Fagrådet for våtrom): prosjekterende, rørlegger og tømrer',
    'Mesterbedrift i tømrerfaget',
    'Sentral godkjenning fra DiBK, tiltaksklasse 1, gyldig til 08.10.2028',
    'Godkjent opplæringsbedrift',
  ],
  built: { count: '1 818', note: 'bad bygget (per oktober 2026)' },
  address: 'Idrettsvegen 93, 5353 Straume',
  phone: '55 50 01 00',
  email: 'vatrom@straumegruppen.no',
  web: 'straumevaatrom.no',
  orgnr: '911 838 346',
  since: 'Etablert 2013',
  demo: 'Konseptdemo',
};

// One price wording for every carrier (the Befaring sheet, the mirror, the delivery box): the law's term, both ends
// incl. VAT, the date, what the range assumes and leaves out, and who stands behind it (research/prices.md 5.8, 7).
// The numbers are the market proposal in research/prices.md until Straume gives its own (kontor/backlog.md).
// Never "prisoverslag" (by law it caps the final price) and never "fra" next to a price.
export const PRICE_TEXT = {
  label: 'Uforpliktende prisantydning',
  vatDate: `inkl. mva · prisnivå ${PRICE_LEVEL}`,
  assumes: (size) => `Gjelder bad på ${size}, vanlige valg.`, // the ranges' own basis: "ordinary choices" (prices.md 6.4)
  excludesShort: 'Ikke med: uforutsette skader, flytting av sluk og rør.',
  how: `En grov prisantydning basert på markedspriser (${PRICE_LEVEL}), størrelsen og valgene dine. Ikke et tilbud.`, // one name for the price everywhere; never "anslag" (too near "overslag", which the law caps)
  includes: 'Arbeid og byggematerialer, riving og avfall, membran, rør, elektro, snekker, flislegging og dokumentasjon. Fliser, armatur og innredning i vanlig til middels klasse.',
  excludes: 'Uforutsette skader, flytting av sluk og rør, nisjer, vindu i våtsone og søknader.',
  // research/prices.md 6.3: the look of this room sits at the lavish end of the visitor's own purchases
  lavish: 'Badet du står i har flere påkostede valg enn dette.',
  next: 'Etter befaringen: fast pris og ferdigdato.', // Straume's own promise ("Fast pris og ferdigstillelsesdato")
  trader: 'Straume Våtrom AS, Idrettsvegen 93, 5353 Straume',
};

// "Visste du?" facts for the mirror. Never about the offer; never shown under the price (the mirror fades its price
// out while a fact shows). idle: shown, once each and in this order, when the room goes quiet; the others are shown
// by their own action (`when`, wired in scene/interactions.js). Each says no more than its source.
export const FACTS = [
  {
    key: 'tilesNotWaterproof',
    idle: true,
    text: 'Fliser og fuger er ikke vanntette. Det er membranen under som holder vannet ute.',
    source: 'SINTEF Byggforsk, «Velg riktig oppbygning, membran og overflatematerialer i våte soner», 05.04.2022',
  },
  {
    key: 'fall',
    idle: true,
    text: 'Gulvet i dusjen faller mot sluket. DiBK godtar blant annet 1:50, altså 2 cm per meter, minst 0,8 m ut fra sluket.',
    source: 'DiBK, veiledning til TEK17 § 13-15, lest 19.10.2026',
  },
  {
    key: 'air',
    idle: true,
    text: 'Et bad trenger avtrekk. DiBKs tall: minst 54 m³ i timen, og 108 når viften går for fullt. Vinduet regnes bare som et tillegg.',
    source: 'DiBK, veiledning til TEK17 § 13-2, lest 19.10.2026',
  },
  {
    key: 'hot55',
    idle: true,
    text: 'Ifølge DiBK skal blandebatteriet ha en sperre, så vannet ved vanlig bruk ikke blir varmere enn 55 °C.',
    source: 'DiBK, veiledning til TEK17 § 15-5, lest 19.10.2026',
  },
  {
    key: 'paper1891',
    idle: false,
    when: 'paperFlip', // the roll flipped twice
    text: 'Seth Wheelers patenttegning av dorullen fra 1891 viser papiret over. Men minst én av tegningene hans viser det under.',
    source: 'US-patent 459 516 (15.09.1891), via Wikipedia «Toilet paper orientation», lest 19.10.2026',
  },
  {
    key: 'penetrations',
    idle: false,
    when: 'membraneLook2', // the tiles are off and the pipe collars show
    text: 'Ifølge DiBK skyldes de fleste vannskader i våtrom utettheter rundt rør og sluk gjennom gulv og vegg, og manglende fall til sluk.',
    source: 'DiBK, veiledning til TEK17 § 13-15, lest 19.10.2026',
  },
];
export const IDLE_FACTS = FACTS.filter((f) => f.idle);

// 'God natt' is said when someone goes to bed, so a late visitor is greeted 'God kveld'.
export const GREETING = (hour) => (hour >= 5 && hour < 10 ? 'God morgen' : hour >= 10 && hour < 17 ? 'God dag' : 'God kveld');

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

export const LINES = {
  touchAll: 'Ta gjerne på alt',
  dragHint: 'Dra for å se deg rundt',
  discovered: (n, total) => `Oppdaget ${n} av ${total}`,
  discoveredCaption: (total) => `av ${total} oppdaget`, // under the ring that holds the number: "5 / av 38 oppdaget"
  yourBath: 'Ditt bad',
  // the mirror after the stamp: nothing has gone anywhere; the visitor's own email app holds the message
  readyToSend: 'Klar til sending',
  pressSend: 'E-posten er din: trykk Send når du vil',
  mailReady: ['Klar til sending', 'E-posten er din: trykk Send når du vil'],
  // the envelope that rises from the bottom drawer if a phone did not open the mail app (concept section 8)
  mailFallback: ['Trykk for å åpne e-posten', 'Du sender den selv'],
  // the mirror after the delivery box swapped the toilet (the pencil rewrites the range on the clipboard)
  swapDone: (label) => [`Byttet til ${lowerFirst(label)}`, 'Ny prisantydning står på arket'],
  // the mirror for a few seconds once the scale's needle has settled (scene/scaleWiring.js): the dial is too small to
  // read from where a visitor stands, so the mirror says where the needle stands, in the dial's own words (low, high:
  // "Enkelt", "Påkostet", fixtures/scale.js DIAL_WORDS); side 'low', 'middle' or 'high'. Never a number or kroner: the
  // scale gives a feeling, the sheet gives the price.
  scaleReading: (side, low, high) => [
    'Badet ditt på vekta',
    side === 'low' ? `Nærmere ${low} enn ${high}` : side === 'high' ? `Nærmere ${high} enn ${low}` : `Omtrent midt mellom ${low} og ${high}`,
  ],
  stampText: 'GRATIS BEFARING ØNSKES',
  holderPlate: 'Vi skrur opp holderen. Retningen bestemmer du.',
  rimless: 'Kantløs: ingen kant der skitt kan gjemme seg.',
  showerTiled: 'Dusjsonen flislegger vi.',
  softClose: 'Myktlukkende sete: det lukker seg selv, stille.',
};

// The clipboard's "Befaring" sheet (systems/clipboard.js).
export const SHEET_TEXT = {
  title: 'Befaring',
  example: 'EKSEMPEL',
  copy: 'DIN KOPI',
  sizeQuestion: 'Hvor stort er badet ditt?',
  choices: 'Valgene dine:',
  stampLeft: ['Gratis', 'befaring'],
  stampRight: ['Hold', 'inne'],
  holdHere: 'her',
  stampBelow: 'Da åpnes e-posten din.\nDu sender den selv.',
  flip: 'Mer om prisen på baksiden →',
  backTitle: 'Om prisen',
  backHow: 'Slik er tallet laget',
  backIn: 'Med i tallet',
  backOut: 'Ikke med',
  flipBack: '← Tilbake til forsiden',
};

// The "Om oss" card in the top drawer (systems/paper.js).
export const CARD_TEXT = {
  flip: 'Godkjenninger på baksiden →',
  flipBack: '← Tilbake til forsiden',
};

// The doormat in front of the bathroom door: the only instructions in the visit, readable from the start view.
// "Trykk" and "dra" work for a finger and a mouse alike; the last line is for a computer's wheel and keys.
export const DOORMAT = {
  title: 'VELKOMMEN INN',
  lines: ['Trykk på døren', 'Trykk på gulvet for å gå', 'Dra for å se deg rundt', 'PC: musehjul eller W A S D'],
};

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DES'];
export const stampDate = (d = new Date()) => `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
