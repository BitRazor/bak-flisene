// Rough, non-binding price data for the exhibit ("uforpliktende prisantydning").
// Every number says where it comes from. The owner asked for rough estimates for now
// (kontor/decisions.md, 2026-10-19: "Prices you get get now rough estimates yourself").
// Market sources and the working are in research/prices.md. All amounts incl. VAT.

export const PRICE_LEVEL = 'oktober 2026';

const MARKET = 'research/prices.md section 6.4 (Byggstart, Mittanbud, FFV 2026; ordinary choices, incl. mva)';
const ESTIMATE = 'Claude-anslag 2026-10-19 (eier: grove anslag OK), research/prices.md section 4';

// Labels without gaps, so every bathroom fits a box (review 2026-10-19: a 4.5 or 7.5 m² bath fitted none). The ranges
// were worked out for about 3–4, 5–7 and 8+ m² (research/prices.md 6.2); at the class edges they are a little rougher.
// Straume's own class limits replace these with its own ranges (kontor/backlog.md).
export const SIZES = {
  lite: { label: 'under 5 m²', range: [200000, 325000], source: MARKET },
  middels: { label: '5–7 m²', range: [250000, 375000], source: MARKET },
  stort: { label: 'over 7 m²', range: [300000, 450000], source: `${MARKET}; weakest size class` },
};

export const DEFAULT_SIZE = 'middels';

// Deltas are against the default choice, as [low, high] in kroner.
export const OPTIONS = {
  toilet: {
    label: 'Toalett',
    default: 'vegghengt',
    choices: {
      vegghengt: {
        label: 'Vegghengt toalett',
        delta: [0, 0],
        why: 'Ramme i veggen, innkasset og flislagt rundt',
        source: ESTIMATE,
      },
      gulvstaaende: {
        label: 'Gulvstående toalett',
        // Equipment: a floor-standing set costs about 2 500–15 000 less than a wall-hung set (products sourced);
        // work: no frame and no boxed wall, about 8 000–10 000 less (old forum figures, index-adjusted; weak).
        delta: [-20000, -10000],
        why: 'Ingen ramme i veggen og ingen innkassing',
        source: ESTIMATE,
      },
    },
  },
};
