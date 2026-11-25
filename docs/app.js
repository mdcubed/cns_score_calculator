import { createCalculator, properties } from './chemistry.js';
import { bbbProperties } from './bbb.js';
import { readList, csvString } from './files.js';

const $ = (id) => document.getElementById(id);
const make = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
const examples = {
  Propranolol: 'CC(C)NCC(O)COc1cccc2ccccc12',
  Aspirin: 'CC(=O)Oc1ccccc1C(=O)O',
  Diphenhydramine: 'CN(C)CCOC(c1ccccc1)c1ccccc1',
};
const records = [],
  pageSize = 25;
let model = 'mpo';
let mode = 'smiles',
  rdkit,
  calculate,
  editor,
  file,
  busy = false,
  active,
  page = 0;
let structureUrl;
function status(text = '', error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
function setBusy(value) {
  busy = value;
  for (const el of document.querySelectorAll(
    '.tabs button,#calculate,#example,#smiles,#pka,#logd,#bbb_pka,#file',
  ))
    el.disabled = value;
  $('calculate').disabled = value || !calculate;
}
function display(row, sample = false) {
  active = row;
  const output = row?.result?.[model];
  const r = output?.error ? null : output;
  const bbb = model === 'bbb';
  const metric = bbb ? 'BBB Score' : 'CNS-MPO score';
  $('metric-name').textContent = metric;
  $('scale-title').textContent = bbb
    ? 'BBB classification threshold'
    : 'CNS desirability threshold';
  $('total').textContent = formatScore(r);
  $('compound-name').textContent = row?.name || 'Awaiting calculation';
  $('sample-label').hidden = !sample;
  $('pointer').hidden = !r;
  $('pointer').parentElement.setAttribute(
    'aria-label',
    r ? metric + ' ' + formatScore(r) + ' out of 6. Threshold 4.' : 'Awaiting calculation',
  );
  if (r) $('pointer').style.left = Math.min(100, Math.max(0, (100 * r.score) / 6)) + '%';
  $('band').textContent =
    output?.error ||
    (r
      ? bbb
        ? r.band
        : r.score >= 4
          ? 'High CNS-MPO desirability'
          : 'Below the high-desirability range'
      : '');
  $('threshold-note').textContent = bbb
    ? 'BBB Score < 4: non-CNS-like. BBB Score ≥ 4: CNS-like.'
    : 'CNS-MPO < 4: below the benchmark. CNS-MPO ≥ 4: high desirability.';
  $('profile-caption').textContent = bbb
    ? 'Weighted contributions · sum to BBB Score'
    : 'Contribution per property · 0–1';
  $('profile').classList.toggle('bbb-profile', bbb);
  $('mpo-method').hidden = bbb;
  $('bbb-method').hidden = !bbb;
  $('structure').replaceChildren();
  if (structureUrl) URL.revokeObjectURL(structureUrl);
  if (row?.result) {
    const mol = rdkit.get_mol(row.result.canonical);
    try {
      const svg = mol.get_svg_with_highlights(
        JSON.stringify({
          width: 260,
          height: 125,
          clearBackground: false,
          bondLineWidth: 2.1,
          padding: 0.08,
          atomColourPalette: {
            6: [0.08, 0.16, 0.25],
            7: [0.12, 0.27, 0.47],
            8: [0.52, 0.36, 0.12],
          },
        }),
      );
      structureUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const img = make('img');
      img.alt = 'Structure of ' + row.name;
      img.src = structureUrl;
      $('structure').append(img);
    } finally {
      mol.delete();
    }
  }
  $('profile').replaceChildren();
  for (const prop of bbb ? bbbProperties : properties) {
    const k = prop.key,
      value = r?.values[k];
    const tile = make('div', undefined, 'tile');
    const label = make('h3', prop.label);
    label.title = prop.full;
    const valueText =
      value == null
        ? '—'
        : ['hbd', 'heavy', 'rings'].includes(k)
          ? value
          : value.toFixed(k === 'mw' ? 1 : k === 'mwhbn' ? 4 : 2);
    const v = make('div', valueText, 'tile-value');
    if (k === 'mw' || k === 'tpsa') v.append(make('small', k === 'mw' ? 'Da' : 'Å²'));
    const bar = make('div', undefined, 'bar'),
      fill = make('i');
    fill.style.width =
      (r ? Math.max(0, Math.min(100, (100 * r.contributions[k]) / (prop.weight ?? 1))) : 0) + '%';
    bar.append(fill);
    const bottom = make('div', undefined, 'tile-foot');
    bottom.append(make('span', 'Contribution'), make('b', r ? r.contributions[k].toFixed(2) : '—'));
    const origin = k === 'pka' ? r?.pkaSource : k === 'logd' ? r?.logdSource : 'RDKit';
    const source = make('div', origin || '—', 'source');
    tile.append(label, v, bar, bottom, source);
    if (bbb) {
      tile.append(make('div', 'Range: ' + prop.range + ' · ×' + prop.weight, 'source'));
      if (k === 'mwhbn' && r)
        source.textContent =
          'HBA ' +
          r.values.hba +
          ' + HBD ' +
          r.values.hbd +
          ' · MW ' +
          r.values.mw.toFixed(2) +
          ' Da';
    }
    $('profile').append(tile);
  }
  for (const tr of $('results').rows)
    tr.classList.toggle('selected', records[Number(tr.dataset.index)] === row);
}
// Preserve the side of the cutoff even when two-decimal rounding would display 4.00.
function formatScore(result) {
  if (!Number.isFinite(result?.score)) return '—';
  const text = result.score.toFixed(2);
  return text === '4.00' && result.score < 4 ? '< 4.00' : text;
}
function rowStatus(row) {
  if (row.error) return row.error;
  const errors = [];
  if (row.result.mpo.error) errors.push('CNS-MPO: ' + row.result.mpo.error);
  if (row.result.bbb.error) errors.push('BBB Score: ' + row.result.bbb.error);
  return errors.join(' ') || 'Calculated';
}
function renderTable() {
  const body = $('results');
  body.replaceChildren();
  const start = page * pageSize;
  for (const [i, row] of records.slice(start, start + pageSize).entries()) {
    const tr = make('tr');
    tr.dataset.index = start + i;
    if (row === active) tr.className = 'selected';
    const name = make('td');
    if (row.result) {
      const btn = make('button', row.name, 'row-link');
      btn.addEventListener('click', () => display(row));
      name.append(btn);
    } else name.textContent = row.name;
    tr.append(
      name,
      make('td', row.smiles),
      make('td', formatScore(row.result?.mpo)),
      make('td', formatScore(row.result?.bbb)),
      make('td', row.result?.bbb.band ?? '—'),
      make('td', rowStatus(row)),
    );
    body.append(tr);
  }
  $('count').textContent = records.length;
  $('empty').hidden = !!records.length;
  $('download').disabled = !records.length;
  $('paging').hidden = records.length <= pageSize;
  $('prev').disabled = page === 0;
  $('next').disabled = start + pageSize >= records.length;
  $('page-info').textContent =
    start + 1 + '–' + Math.min(start + pageSize, records.length) + ' of ' + records.length;
}
function scoreItem(input, index) {
  const row = { ...input, name: input.name || 'Compound ' + (index + 1) };
  try {
    row.result = calculate(row);
    if (row.result.mpo.error && row.result.bbb.error) row.error = rowStatus(row);
  } catch (e) {
    row.error = e instanceof Error ? e.message : 'Unable to read this structure.';
  }
  return row;
}
function clearOverrides() {
  $('pka').value = '';
  $('logd').value = '';
  $('bbb_pka').value = '';
}
function resetView() {
  display(null);
  status();
}
function acceptFile(value) {
  file = value;
  $('filename').textContent = file?.name || 'Choose a file or drop it here';
  resetView();
}
async function switchMode(next) {
  if (busy || next === mode) return;
  mode = next;
  document
    .querySelectorAll('[data-mode]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  for (const key of ['smiles', 'draw', 'upload']) $(key + '-panel').hidden = key !== mode;
  $('overrides').hidden = mode === 'upload';
  $('calculate').querySelector('span').textContent =
    mode === 'upload' ? 'Calculate list' : 'Calculate scores';
  clearOverrides();
  resetView();
  if (mode === 'draw' && !editor) {
    setBusy(true);
    try {
      const { CanvasEditor } = await import('./vendor/openchemlib.js');
      editor = new CanvasEditor($('editor'));
      editor.setOnChangeListener((event) => {
        if (mode !== 'draw' || event.type !== 'molecule' || !event.isUserEvent) return;
        if (active?.smiles === editor.getMolecule().toIsomericSmiles()) return;
        clearOverrides();
        resetView();
      });
    } catch {
      status('Could not load the drawing editor. Reload the page to retry.', true);
    } finally {
      setBusy(false);
    }
  }
}
async function run() {
  if (busy || !calculate) return;
  setBusy(true);
  status();
  const start = records.length;
  try {
    let inputs;
    if (mode === 'upload') {
      if (!file) throw new Error('Choose a file containing SMILES first.');
      inputs = readList(await file.text(), file.name);
      if (!inputs.length) throw new Error('The file needs at least one compound row.');
    } else {
      const smiles =
        mode === 'draw' ? editor?.getMolecule().toIsomericSmiles() : $('smiles').value.trim();
      if (!smiles)
        throw new Error(
          mode === 'draw' ? 'Draw a molecule first.' : 'Enter a SMILES string first.',
        );
      for (const k of ['pka', 'logd', 'bbb_pka'])
        if (!$(k).validity.valid) throw new Error('Check the ' + k + ' override.');
      const name = Object.keys(examples).find((key) => examples[key] === smiles);
      inputs = [
        { name, smiles, pka: $('pka').value, logd: $('logd').value, bbb_pka: $('bbb_pka').value },
      ];
    }
    let first,
      failed = 0,
      partial = 0;
    for (let i = 0; i < inputs.length; i++) {
      const row = scoreItem(inputs[i], start + i);
      if (row.error && mode !== 'upload') throw new Error(row.error);
      if (row.error) failed++;
      else {
        first ??= row;
        if (row.result.mpo.error || row.result.bbb.error) partial++;
      }
      records.push(row);
      if ((i + 1) % 40 === 0 && i + 1 < inputs.length) {
        status('Processed ' + (i + 1) + ' of ' + inputs.length + ' compounds…');
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    page = Math.floor(start / pageSize);
    display(first);
    renderTable();
    status(
      mode === 'upload'
        ? inputs.length -
            failed -
            partial +
            ' calculated · ' +
            (partial ? partial + ' partial · ' : '') +
            failed +
            ' failed. See the compound list below.'
        : partial
          ? rowStatus(first)
          : 'Added to calculated compounds.',
    );
  } catch (e) {
    display(null);
    status(e.message || 'Calculation failed.', true);
  } finally {
    setBusy(false);
  }
}
$('file').addEventListener('change', (e) => acceptFile(e.target.files[0]));
for (const event of ['dragover', 'dragleave', 'drop'])
  $('drop').addEventListener(event, (e) => {
    e.preventDefault();
    $('drop').classList.toggle('drag', event === 'dragover');
    if (event === 'drop' && !busy) acceptFile(e.dataTransfer.files[0]);
  });
document
  .querySelectorAll('[data-mode]')
  .forEach((b) => (b.onclick = () => switchMode(b.dataset.mode)));
$('smiles').addEventListener('input', () => {
  clearOverrides();
  resetView();
});
for (const k of ['pka', 'logd', 'bbb_pka']) $(k).addEventListener('input', resetView);
$('example').onchange = () => {
  const name = $('example').value;
  if (!name) return;
  $('smiles').value = examples[name];
  clearOverrides();
  $('example').value = '';
  display(scoreItem({ name, smiles: examples[name] }, 0), true);
  status();
};
for (const button of document.querySelectorAll('[data-model]')) {
  button.onclick = () => {
    model = button.dataset.model;
    for (const other of document.querySelectorAll('[data-model]'))
      other.setAttribute('aria-pressed', String(other === button));
    display(active, !$('sample-label').hidden);
  };
}
$('calculate').onclick = run;
$('smiles').onkeydown = (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    run();
  }
};
$('prev').onclick = () => {
  page--;
  renderTable();
};
$('next').onclick = () => {
  page++;
  renderTable();
};
$('download').onclick = () => {
  const keys = properties.map((x) => x.key);
  const header = [
    'name',
    'smiles',
    'canonical_smiles',
    'cns_mpo',
    ...keys,
    ...keys.map((k) => k + '_contribution'),
    'pka_source',
    'logd_source',
    'status',
  ];
  const bbbKeys = bbbProperties.map((p) => p.key);
  header.push(
    'bbb_score',
    'bbb_band',
    'aromatic_rings',
    'heavy_atoms',
    'hba',
    'mwhbn',
    'bbb_pka',
    'bbb_pka_source',
    ...bbbKeys.map((k) => 'bbb_' + k + '_contribution'),
  );
  const rows = records.map((row) => {
    const r = row.result?.mpo,
      b = row.result?.bbb;
    return [
      row.name,
      row.smiles,
      row.result?.canonical,
      r?.score,
      ...keys.map(
        (k) => r?.values?.[k] ?? (['mw', 'hbd', 'tpsa'].includes(k) ? b?.values?.[k] : undefined),
      ),
      ...keys.map((k) => r?.contributions?.[k]),
      r?.pkaSource,
      r?.logdSource,
      rowStatus(row),
      b?.score,
      b?.band,
      b?.values?.rings,
      b?.values?.heavy,
      b?.values?.hba,
      b?.values?.mwhbn,
      b?.values?.pka,
      b?.pkaSource,
      ...bbbKeys.map((k) => b?.contributions?.[k]),
    ];
  });
  const url = URL.createObjectURL(
    new Blob([csvString([header, ...rows])], { type: 'text/csv;charset=utf-8' }),
  );
  const link = make('a');
  link.href = url;
  link.download = 'cns-mpo-bbb-results.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
};
$('method').onclick = () => $('method-dialog').showModal();
$('close').onclick = () => $('method-dialog').close();
$('method-dialog').onclick = (e) => {
  if (e.target === $('method-dialog') && !e.target.matches(':hover')) e.target.close();
};
for (const p of properties) {
  const tr = make('tr');
  tr.append(
    make('td', p.label),
    make('td', p.range),
    make('td', p.key === 'tpsa' ? '≤ 20 or ≥ 120' : '≥ ' + p.limits[1]),
  );
  $('method-rows').append(tr);
}
for (const prop of bbbProperties) {
  const tr = make('tr');
  tr.append(make('td', prop.label), make('td', prop.range), make('td', '×' + prop.weight));
  $('bbb-method-rows').append(tr);
}
setBusy(true);
try {
  rdkit = await window.initRDKitModule({
    locateFile: (filename) => new URL('vendor/' + filename, document.baseURI).href,
  });
  const parameters = await fetch(
    new URL('vendor/dimorphite/site_substructures.smarts', document.baseURI),
  );
  if (!parameters.ok) throw new Error('Could not load ionization parameters.');
  calculate = createCalculator(rdkit, await parameters.text());
  const demo = scoreItem({ name: 'Propranolol', smiles: examples.Propranolol }, 0);
  if (demo.error) throw new Error(demo.error);
  display(demo, true);
  status();
} catch (e) {
  calculate = null;
  console.error(e);
  display(null);
  status('Could not initialize the chemistry engine. Reload the page to retry.', true);
} finally {
  setBusy(false);
  if (!calculate) $('example').disabled = true;
}
