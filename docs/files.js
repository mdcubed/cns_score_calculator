// Read quoted fields, doubled quotes, CRLF, and newlines inside quoted CSV fields.
function delimited(text, delimiter) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false,
    closed = false;
  function finishField() {
    row.push(field.trim());
    field = '';
    closed = false;
  }
  function finishRow() {
    finishField();
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (ch === delimiter) finishField();
    else if (ch === '\r' || ch === '\n') {
      finishRow();
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else if (ch === '"' && !field && !closed) quoted = true;
    else if (closed && ch.trim()) throw new Error('Unexpected text after a quoted CSV field.');
    else field += ch;
  }
  if (quoted) throw new Error('The file contains an unclosed quoted field.');
  finishRow();
  return rows;
}
export function readList(content, filename) {
  const text = content.replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('The file is empty.');
  const firstLine = text.split(/[\r\n]/, 1)[0];
  let delimiter = null;
  if (/\.csv$/i.test(filename)) delimiter = ',';
  else if (/\.tsv$/i.test(filename) || firstLine.includes('\t')) delimiter = '\t';
  else if (!/\.smi(les)?$/i.test(filename) && /^\S+?,/.test(firstLine)) delimiter = ',';
  if (!delimiter) {
    const lines = text
      .split(/\r\n?|\n/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (/^smiles(?:\s|$)/i.test(lines[0])) lines.shift();
    return lines.map((line) => {
      const [, smiles, name] = /^(\S+)(?:\s+(.+))?$/.exec(line);
      return { smiles, name };
    });
  }
  const rows = delimited(text, delimiter);
  if (!rows.length) throw new Error('The file is empty.');
  const header = rows[0].map((x) => x.toLowerCase());
  const s = header.indexOf('smiles');
  if (s < 0) return rows.map(([smiles, name]) => ({ smiles, name }));
  const n = header.findIndex((x) => ['name', 'id', 'compound', 'compound_id'].includes(x));
  const p = header.indexOf('pka'),
    d = header.indexOf('logd'),
    bbb = header.indexOf('bbb_pka');
  return rows
    .slice(1)
    .map((row) => ({
      smiles: row[s] || '',
      name: row[n],
      pka: row[p],
      logd: row[d],
      bbb_pka: row[bbb],
    }));
}
export function csvString(rows) {
  function field(value) {
    let s = String(value ?? '');
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return '\uFEFF' + rows.map((row) => row.map(field).join(',')).join('\r\n') + '\r\n';
}
