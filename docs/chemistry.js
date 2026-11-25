import { selectBbbPka, workbookScore } from './bbb.js';
// Dimorphite-DL's ordered SMARTS and fitted mean pKa values are bundled in vendor/dimorphite.
// These groups protonate as bases. Other included rules describe loss of an acidic proton.
const basicGroups = new Set([
  'Nitroguanidine',
  'Nitroimine_guanidine',
  'AmidineGuanidine1',
  'Amidine_carbon_substituted',
  'AmidineGuanidine2',
  'Adenine_N9_substituted',
  'Guanine_N9_substituted_N7',
  'Cytosine_N1_substituted',
  'Anilines_primary',
  'Anilines_secondary_N_alkyl',
  'Anilines_secondary',
  'Anilines_tertiary',
  'Diazine',
  'Aromatic_nitrogen_unprotonated',
  'Fluoroalkylamine',
  'Benzylic_amine',
  'Beta_hydroxy_amine',
  'Alkylamine_primary',
  'Alkylamine_secondary',
  'Alkylamine_tertiary',
  'Amines_primary_secondary_tertiary',
  'Primary_hydroxyl_amine',
]);
export const properties = [
  { key: 'logp', label: 'cLogP', full: 'Calculated logP', range: '≤ 3', limits: [3, 5] },
  { key: 'logd', label: 'logD₇.₄', full: 'logD at pH 7.4', range: '≤ 2', limits: [2, 4] },
  { key: 'mw', label: 'MW', full: 'Molecular weight (Da)', range: '≤ 360 Da', limits: [360, 500] },
  {
    key: 'tpsa',
    label: 'TPSA',
    full: 'Topological polar surface area (Å²)',
    range: '40–90 Å²',
    limits: [20, 40, 90, 120],
  },
  { key: 'hbd', label: 'HBD', full: 'Hydrogen-bond donors', range: '≤ 0.5', limits: [0.5, 3.5] },
  { key: 'pka', label: 'pKa', full: 'Most basic pKa', range: '≤ 8', limits: [8, 10] },
];
const clamp = (x) => Math.max(0, Math.min(1, x));
export function desirability(value, limits) {
  const [a, b, c, d] = limits;
  if (limits.length === 4) return clamp(Math.min((value - a) / (b - a), (d - value) / (d - c)));
  return clamp((b - value) / (b - a));
}
function numeric(raw, label) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error('Enter a finite number for ' + label + '.');
  return n;
}

function calculateMpo(desc, { basic, acidic, unknownBase }, { pka, logd }) {
  const givenPka = numeric(pka, 'pKa'),
    givenLogd = numeric(logd, 'logD');
  if (unknownBase && givenPka === null)
    throw new Error('Supply a basic pKa for this imine in the property overrides.');
  const basicPka = givenPka ?? (basic.length ? Math.max(...basic) : null);
  const acidPka = acidic.length ? Math.min(...acidic) : null;
  const ionTerms = [0];
  if (basicPka !== null) ionTerms.push(basicPka - 7.4);
  if (acidPka !== null && Number.isFinite(acidPka)) ionTerms.push(7.4 - acidPka);
  const largest = Math.max(...ionTerms);
  const logCorrection =
    largest + Math.log10(ionTerms.reduce((sum, x) => sum + 10 ** (x - largest), 0));
  const values = {
    logp: desc.CrippenClogP,
    logd: givenLogd ?? desc.CrippenClogP - logCorrection,
    mw: desc.amw,
    tpsa: desc.tpsa,
    hbd: desc.NumHBD,
    pka: basicPka,
  };
  const contributions = {};
  for (const { key, limits } of properties) {
    if (key === 'pka' && basicPka === null) contributions.pka = 1;
    else {
      if (!Number.isFinite(values[key]))
        throw new Error('The property model could not score this structure.');
      contributions[key] = desirability(values[key], limits);
    }
  }
  return {
    values,
    contributions,
    score: Object.values(contributions).reduce((a, b) => a + b, 0),
    pkaSource:
      givenPka !== null
        ? 'Supplied'
        : basicPka === null
          ? 'No basic site matched'
          : 'Fragment estimate',
    logdSource: givenLogd !== null ? 'Supplied' : 'Ionization estimate',
  };
}

function calculateBbb(desc, { basic, acidic, unknownBase }, { bbb_pka }) {
  const override = numeric(bbb_pka, 'BBB pKa');
  if (unknownBase && override === null) throw new Error('Supply a BBB pKa for this imine.');
  const { pka: selected, pkaSource } = selectBbbPka(basic, acidic, override);
  return {
    ...workbookScore({
      rings: desc.NumAromaticRings,
      heavy: desc.NumHeavyAtoms,
      mw: desc.amw,
      hba: desc.NumHBA,
      hbd: desc.NumHBD,
      tpsa: desc.tpsa,
      pka: selected,
    }),
    pkaSource,
  };
}

function evaluate(model, desc, sites, input) {
  try {
    return model(desc, sites, input);
  } catch (error) {
    return { error: error.message };
  }
}

const parserOptions = JSON.stringify({ sanitize: true, removeHs: true });
export function createCalculator(rdkit, parameterText) {
  function compile(pattern) {
    const query = rdkit.get_qmol(pattern);
    if (!query) throw new Error('Unable to initialize the ionization model.');
    return query;
  }
  const rules = [];
  for (const line of parameterText.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [name, pattern, ...parameters] = line.trim().split(/\s+/);
    const sites = [];
    for (let i = 0; i < parameters.length; i += 3) {
      const pka = Number(parameters[i + 1]);
      // The upstream -1000 sentinel encodes a forced charge, not a pKa.
      if (pka !== -1000) sites.push({ index: Number(parameters[i]), pka });
    }
    if (sites.length) rules.push({ basic: basicGroups.has(name), query: compile(pattern), sites });
  }
  const imine = compile('[NX2+0]=[CX3]');
  const ions = compile('[+1,+2,+3,-1,-2,-3;!$([N+](=O)[O-]);!$([O-][N+]=O)]');
  const unsupported = compile('[!#1;!#5;!#6;!#7;!#8;!#9;!#15;!#16;!#17;!#35;!#53]');
  function ionizationSites(mol) {
    // The upstream SMARTS explicitly match hydrogens. Keep the original graph for descriptors.
    const expanded = rdkit.get_mol_copy(mol);
    try {
      expanded.add_hs_in_place();
      const assigned = new Set(),
        basic = [],
        acidic = [];
      for (const rule of rules) {
        const hits = JSON.parse(expanded.get_substruct_matches(rule.query));
        if (!Array.isArray(hits)) continue;
        for (const { atoms } of hits) {
          for (const site of rule.sites) {
            const atom = atoms[site.index];
            if (assigned.has(atom)) continue;
            assigned.add(atom);
            (rule.basic ? basic : acidic).push(site.pka);
          }
        }
      }
      const imines = JSON.parse(expanded.get_substruct_matches(imine));
      const unknownBase =
        Array.isArray(imines) && imines.some((hit) => !assigned.has(hit.atoms[0]));
      return { basic, acidic, unknownBase };
    } finally {
      expanded.delete();
    }
  }
  return function calculate(input) {
    const { smiles } = input;
    if (!smiles || /\s|[*>|]/.test(smiles)) throw new Error('Enter one complete molecular SMILES.');
    const mol = rdkit.get_mol(smiles, parserOptions);
    if (!mol) throw new Error('Invalid SMILES. Check the atoms, bonds and ring closures.');
    try {
      const canonical = mol.get_smiles();
      if (!canonical || canonical.includes('.'))
        throw new Error('Enter a single parent structure without salts or mixtures.');
      if (JSON.parse(mol.get_substruct_match(unsupported)).atoms)
        throw new Error('This model supports organic small molecules only.');
      if (JSON.parse(mol.get_substruct_match(ions)).atoms)
        throw new Error(
          'Use the neutral parent structure. Charged forms require a different descriptor model.',
        );
      const desc = JSON.parse(mol.get_descriptors());
      const sites = ionizationSites(mol);
      return {
        canonical,
        mpo: evaluate(calculateMpo, desc, sites, input),
        bbb: evaluate(calculateBbb, desc, sites, input),
      };
    } finally {
      mol.delete();
    }
  };
}
