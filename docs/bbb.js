// Gupta et al. BBB Score descriptors.
export const bbbProperties = [
  {
    key: 'rings',
    label: 'Aromatic rings',
    full: 'Number of aromatic rings',
    weight: 1,
    range: '0–4 rings',
  },
  {
    key: 'heavy',
    label: 'Heavy atoms',
    full: 'Number of non-hydrogen atoms',
    weight: 1,
    range: '6–45 atoms',
  },
  {
    key: 'mwhbn',
    label: 'MWHBN',
    full: '(HBA + HBD) / √MW',
    weight: 1.5,
    range: '0.05 < x ≤ 0.45',
  },
  {
    key: 'tpsa',
    label: 'TPSA',
    full: 'Topological polar surface area',
    weight: 2,
    range: '0 < x ≤ 120 Å²',
  },
  {
    key: 'pka',
    label: 'BBB pKa',
    full: 'pKa selected for the BBB Score',
    weight: 0.5,
    range: '3 < x ≤ 11',
  },
];
export function selectBbbPka(basic, acidic, override) {
  if (override !== null) return { pka: override, pkaSource: 'Supplied' };
  const base = Math.max(...basic);
  if (base >= 5) return { pka: base, pkaSource: 'Most basic site' };
  const acid = Math.min(...acidic);
  if (acid <= 9) return { pka: acid, pkaSource: 'Most acidic site' };
  return { pka: 8.81, pkaSource: 'Neutral default' };
}
export const bbbBand = (score) => (score >= 4 ? 'CNS-like' : 'Non-CNS-like');

export function workbookScore({ rings, heavy, mw, hba, hbd, tpsa, pka }) {
  if (![rings, heavy, mw, hba, hbd, tpsa, pka].every(Number.isFinite) || mw <= 0)
    throw new Error('A descriptor required for the BBB Score is unavailable.');
  const mwhbn = (hba + hbd) / Math.sqrt(mw);
  // Keep full precision when weighting contributions and classifying the total.
  const contributions = {
    rings: [0.336376, 0.816016, 1, 0.691115, 0.199399][rings] ?? 0,
    heavy:
      heavy > 5 && heavy <= 45
        ? (0.0000443 * heavy ** 3 - 0.004556 * heavy ** 2 + 0.12775 * heavy - 0.463) / 0.624231
        : 0,
    mwhbn:
      mwhbn > 0.05 && mwhbn <= 0.45
        ? (1.5 * (26.733 * mwhbn ** 3 - 31.495 * mwhbn ** 2 + 9.5202 * mwhbn - 0.1358)) / 0.72258
        : 0,
    tpsa: tpsa > 0 && tpsa <= 120 ? (2 * (-0.0067 * tpsa + 0.9598)) / 0.9598 : 0,
    pka:
      pka > 3 && pka <= 11
        ? (0.5 *
            (0.00045068 * pka ** 4 -
              0.016331 * pka ** 3 +
              0.18618 * pka ** 2 -
              0.71043 * pka +
              0.8579)) /
          0.597488
        : 0,
  };
  const score = Object.values(contributions).reduce((sum, x) => sum + x, 0);
  return {
    values: { rings, heavy, mw, hba, hbd, mwhbn, tpsa, pka },
    contributions,
    score,
    band: bbbBand(score),
  };
}
