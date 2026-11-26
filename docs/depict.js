// Shared 2D depiction helpers for the results table and the file exports.
//
// A depiction is generated once per record and cached on the record itself, so
// paging through the table, re-rendering after a calculation, and exporting all
// reuse the same SVG instead of asking RDKit to lay the molecule out again.

const DEPICTION = {
  width: 220,
  height: 110,
  clearBackground: false,
  bondLineWidth: 1.8,
  padding: 0.08,
  atomColourPalette: {
    6: [0.08, 0.16, 0.25],
    7: [0.12, 0.27, 0.47],
    8: [0.52, 0.36, 0.12],
  },
};

export const depictionSize = { width: DEPICTION.width, height: DEPICTION.height };

// Returns '' rather than throwing: a row that failed to parse still has to render.
export function depictionSvg(rdkit, smiles, options = {}) {
  if (!rdkit || !smiles) return '';
  let mol;
  try {
    mol = rdkit.get_mol(smiles);
    if (!mol || !mol.is_valid()) return '';
    return mol.get_svg_with_highlights(JSON.stringify({ ...DEPICTION, ...options }));
  } catch {
    return '';
  } finally {
    mol?.delete();
  }
}

// A data: URI instead of an object URL — nothing to revoke when a row scrolls
// out of the page, and the same string drops straight into a CSV cell.
export function svgDataUri(svg) {
  return svg ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) : '';
}

export function rowDepiction(rdkit, row) {
  if (row.depiction === undefined) {
    const svg = depictionSvg(rdkit, row.result?.canonical || row.smiles);
    row.depiction = svg ? { svg, uri: svgDataUri(svg) } : null;
  }
  return row.depiction;
}

// Excel embeds PNG, not SVG, so the depiction is rasterized through a canvas.
// Drawn at 2x and placed at 1x so the picture stays sharp when the sheet is
// zoomed or printed. Resolves to null on any failure; the export then just
// leaves that cell empty rather than aborting the whole workbook.
export function svgToPng(svg, scale = 2) {
  return new Promise((resolve) => {
    if (!svg) return resolve(null);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(DEPICTION.width * scale);
        canvas.height = Math.round(DEPICTION.height * scale);
        const context = canvas.getContext('2d');
        // RDKit draws on transparency; Excel shows that as black on some themes.
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/png').split(',')[1];
        resolve(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = svgDataUri(svg);
  });
}
