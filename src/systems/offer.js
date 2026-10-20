// The offer request: the visitor's own email, written for them, sent by them.
// The page stores and sends nothing. The email lists choices, never a price in kroner
// (research/prices.md 5.8 point 6: the room's figure must not become "the price of the job").
// It is read by Straume, so it says things once, plainly, and never presents an untouched default as the visitor's.
import { SIZES, OPTIONS, DEFAULT_SIZE } from '../data/prices.js';
import { sizeLabel } from './price.js';

export const ACCEPT_SENTENCE =
  'Jeg har sett den uforpliktende prisantydningen og ønsker en gratis, uforpliktende befaring.';

export const SUBJECT = 'Gratis befaring – fra det digitale badet';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Straume's own price form asks the same (research/company.md section 6)
const HOME_TYPES = 'enebolig, tomannsbolig/rekkehus eller blokk/leilighet';

export function encodeChoices({ size = DEFAULT_SIZE, choices = {} }) {
  const parts = [`s=${size}`];
  for (const key of Object.keys(choices).sort()) parts.push(`${key}=${choices[key]}`);
  return parts.join(';');
}

export function decodeChoices(code) {
  const out = { size: DEFAULT_SIZE, choices: {} };
  if (!code) return out;
  for (const part of String(code).split(';')) {
    const [key, value] = part.split('=');
    if (key === 's') {
      if (SIZES[value]) out.size = value;
    } else if (OPTIONS[key] && OPTIONS[key].choices[value]) {
      out.choices[key] = value;
    }
  }
  return out;
}

function choiceLines({ choices = {} }) {
  const lines = [];
  for (const [group, opt] of Object.entries(OPTIONS)) {
    const key = choices[group] ?? opt.default;
    lines.push(`- ${opt.choices[key].label}`);
  }
  return lines;
}

// state.sizeChosen: true once the visitor ticked a size box, false while the sheet shows only the default (set by the
// touch layer); left out, the size is given as what the sheet showed.
function sizeLine(state) {
  if (state.sizeChosen === false) return 'Størrelse: ikke valgt ennå';
  if (state.sizeChosen === true) return `Størrelse jeg krysset av: ${sizeLabel(state.size)}`;
  return `Størrelse på arket: ${sizeLabel(state.size)}`;
}

export function buildOfferMail({ to = '', state, baseUrl }) {
  const code = encodeChoices(state);
  const link = `${baseUrl}#bad=${encodeURIComponent(code)}`;
  const body = [
    'Hei Straume Våtrom,',
    '',
    'jeg har satt sammen et bad i det digitale badet deres.',
    '',
    sizeLine(state),
    'Valgene mine:',
    ...choiceLines(state),
    '',
    ACCEPT_SENTENCE,
    '',
    `Badet jeg satte sammen: ${link}`,
    '',
    'Navn:',
    'Telefon:',
    'Adresse:',
    `Boligtype (${HOME_TYPES}):`,
    'Etasje:',
    'Gulvareal (m²):',
    '',
    'Hilsen',
  ].join('\r\n');
  const addr = EMAIL_RE.test(to) ? to : '';
  return `mailto:${addr}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(body)}`;
}
