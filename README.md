# MD³ CNS-MPO and BBB Score Calculator

The static dashboard in `docs/` scores pasted SMILES, structures drawn with OpenChemLib, and uploaded compound lists with both models. Switch between **CNS-MPO** and **BBB Score** in the score overview to inspect a compound. The results table and CSV show both totals and the BBB classification. All calculations run in the browser. Reloading the page clears the session. Download the CSV to keep compound names, input and canonical SMILES, scores, property values, contributions, estimate sources and row errors.

## GitHub Pages

The public file list is in `.gitignore`. New files, local references, compound libraries and result exports are ignored by default. Review new public assets before adding their exact paths to that list.

In a fresh clone, install [Gitleaks](https://github.com/gitleaks/gitleaks) v8.30 or newer and run `git config --local core.hooksPath .githooks`. The pre-push hook checks outgoing history for ignored paths and scans file changes and commit or tag messages for credentials. Review changes to public source files and the example CSV for confidential compound structures. For checks across contributors and the GitHub web interface, enable [repository push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection) on GitHub.

Commit the project to the target GitHub repository. In **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, select the branch containing the dashboard and choose **/docs**. The site uses relative asset paths and includes its browser dependencies. No build or API credentials are required.

For local preview, run `python3 -m http.server 8000 --directory docs` from the project root and open `http://localhost:8000/`.

## Compound lists

CSV and TSV support a `smiles` column and optional `name` or `id`, `pka` (most basic pKa), `logd` (at pH 7.4), and `bbb_pka` (the pKa entered in the BBB workbook). Headerless lists accept SMILES in the first column and a name in the second. TXT and SMI accept one SMILES followed by an optional whitespace-separated name on each line. Use single neutral parent molecules. The export preserves unsuccessful batch entries and explains each error.

## Scoring

The six Wager desirability functions sum to a value between 0 and 6. The **Method** panel lists their endpoints and explains the property models. RDKit.js 2026.9.2 supplies cLogP, molecular weight, TPSA and HBD. The most basic pKa is estimated with Dimorphite-DL fragment matches and their fitted mean pKa values. Estimated logD uses the strongest matched acidic and basic sites. Both estimates can be overridden. OpenChemLib 9.26.0 supplies the structure editor. Bundled dependency licenses are in `docs/vendor/`.

A CNS-MPO score ≥ 4 indicates high property desirability. [Wager et al., 2010](https://doi.org/10.1021/cn100008c) · [Wager et al., 2016](https://doi.org/10.1021/acschemneuro.6b00029).

### Gupta BBB Score

The dashboard implements the supplied workbook’s five weighted terms. A **BBB Score < 4** is in the **non-CNS-like** band. A **BBB Score ≥ 4** is in the **CNS-like** band. The classification uses the unrounded score.

| Workbook descriptor | Scored range | Weight |
| --- | --- | ---: |
| Aromatic rings | 0–4 (highest at 2) | 1 |
| Heavy atoms | 6–45 inclusive | 1 |
| (HBA + HBD) / √MW | > 0.05 and ≤ 0.45 | 1.5 |
| TPSA (Å²) | > 0 and ≤ 120 | 2 |
| pKa | > 3 and ≤ 11 | 0.5 |

Each term is zero outside its range. The workbook’s fitted functions determine the contribution inside the range. For the BBB pKa, the dashboard uses the highest estimated basic pKa ≥ 5, then the lowest estimated acidic pKa ≤ 9, then the authors’ neutral default of 8.81. The optional `bbb_pka` value takes precedence. Molecular descriptors and pKa estimates can differ across software even when the scoring formulas agree.

The workbook’s stored example evaluates to **5.040301056516096**. The regression checks in `tests/bbb.test.mjs` cover this reference, the descriptor endpoints, pKa selection and the classification boundary. Run them with `node --test tests/bbb.test.mjs` (Node 22.7 or newer). [Gupta et al., 2019](https://doi.org/10.1021/acs.jmedchem.9b01220) · [Workbook](https://doi.org/10.1021/acs.jmedchem.9b01220.s001) · [Supporting information, Table S1](https://doi.org/10.1021/acs.jmedchem.9b01220.s002).
