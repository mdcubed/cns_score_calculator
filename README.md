# MD³ CNS-MPO and BBB Score Calculator

Paste a SMILES string, draw a structure or upload a compound list to calculate both scores in your browser. Select a model in **Score overview** to inspect each property’s contribution. Download the results as CSV or Excel before reloading the page, which clears the session.

## Compound lists

Use one neutral parent molecule per entry. CSV and TSV files accept the following columns.

| Column | Value |
| --- | --- |
| `smiles` | Molecular structure (required) |
| `name` or `id` | Compound identifier |
| `pka` | Most basic pKa for CNS-MPO |
| `logd` | LogD at pH 7.4 for CNS-MPO |
| `bbb_pka` | pKa for the BBB Score |

Leave optional property values blank to use estimates. Headerless CSV and TSV files take SMILES in the first column and an optional name in the second. TXT and SMI files take one SMILES per line followed by an optional name. The export includes both scores, the BBB classification, property values, contributions and any row errors. The Excel workbook shows each 2D structure next to the compound name; the CSV carries it as an SVG data URI in `structure_svg`. [Example CSV](docs/example.csv)

## Interpreting the scores

**CNS-MPO** sums six property contributions on a scale from 0 to 6. A score of 4 or higher indicates high CNS property desirability. [Wager et al., 2010](https://doi.org/10.1021/cn100008c) · [Wager et al., 2016](https://doi.org/10.1021/acschemneuro.6b00029)

**BBB Score** combines five weighted descriptors. An unrounded score below 4 is classified as non-CNS-like. A score of 4 or higher is classified as CNS-like. [Gupta et al., 2019](https://doi.org/10.1021/acs.jmedchem.9b01220)

Open **Method** for descriptor ranges, weights and how the calculator estimates pKa and logD. Dependency licenses are in `docs/vendor/`.
