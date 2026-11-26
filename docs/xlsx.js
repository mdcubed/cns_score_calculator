// Minimal XLSX writer: one worksheet, inline strings, and PNG pictures anchored
// to cells.
//
// Deliberately dependency-free. The calculator vendors everything it needs and
// runs offline from a static host, so pulling in a spreadsheet library would
// mean vendoring another megabyte. An .xlsx is a ZIP of XML parts; the few
// parts needed for "a grid with pictures in it" are written out by hand below.
//
// Entries are STORED (no deflate) — PNG data is already compressed and the XML
// is small, so the saving would not pay for a deflate implementation.

const EMU_PER_PX = 9525;
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
    // Control characters are not representable in XML 1.0; Excel rejects the
    // whole file if one reaches a cell.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(entry.data);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed to extract
    lv.setUint16(6, 0x0800, true); // UTF-8 file names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true); // modified time
    lv.setUint16(12, 0x21, true); // modified date = 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, data);

    const header = new Uint8Array(46 + name.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x02014b50, true);
    hv.setUint16(4, 20, true); // version made by
    hv.setUint16(6, 20, true);
    hv.setUint16(8, 0x0800, true);
    hv.setUint16(10, 0, true);
    hv.setUint16(12, 0, true);
    hv.setUint16(14, 0x21, true);
    hv.setUint32(16, crc, true);
    hv.setUint32(20, data.length, true);
    hv.setUint32(24, data.length, true);
    hv.setUint16(28, name.length, true);
    hv.setUint32(42, offset, true); // offset of local header
    header.set(name, 46);
    central.push(header);
    offset += local.length + data.length;
  }
  const directory = central.reduce((sum, h) => sum + h.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directory, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function cellXml(value, reference, style) {
  const s = style ? ` s="${style}"` : '';
  if (value === null || value === undefined || value === '') return `<c r="${reference}"${s}/>`;
  if (typeof value === 'number' && Number.isFinite(value))
    return `<c r="${reference}"${s}><v>${value}</v></c>`;
  return (
    `<c r="${reference}"${s} t="inlineStr"><is><t xml:space="preserve">` +
    escapeXml(value) +
    '</t></is></c>'
  );
}

function rowXml(index, cells, style, height) {
  const attrs = height ? ` ht="${height}" customHeight="1"` : '';
  const body = cells
    .map((value, column) => cellXml(value, columnName(column) + index, style))
    .join('');
  return `<row r="${index}"${attrs}>${body}</row>`;
}

function sheetXml({ header, rows, columnWidths, rowHeight, hasDrawing }) {
  const cols = columnWidths?.length
    ? '<cols>' +
      columnWidths
        .map((width, i) =>
          width ? `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>` : '',
        )
        .join('') +
      '</cols>'
    : '';
  const body = rows.map((row, i) => rowXml(i + 2, row, 0, rowHeight)).join('');
  return (
    `${XML_DECL}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr>' +
    cols +
    `<sheetData>${rowXml(1, header, 1)}${body}</sheetData>` +
    (hasDrawing ? '<drawing r:id="rId1"/>' : '') +
    '</worksheet>'
  );
}

function drawingXml(images, size) {
  const cx = Math.round(size.width * EMU_PER_PX);
  const cy = Math.round(size.height * EMU_PER_PX);
  const anchors = images
    .map(
      (image, i) =>
        '<xdr:oneCellAnchor>' +
        `<xdr:from><xdr:col>${image.column}</xdr:col><xdr:colOff>19050</xdr:colOff>` +
        `<xdr:row>${image.row}</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>` +
        `<xdr:ext cx="${cx}" cy="${cy}"/>` +
        '<xdr:pic><xdr:nvPicPr>' +
        `<xdr:cNvPr id="${i + 2}" name="Structure ${i + 1}" descr="${escapeXml(image.alt)}"/>` +
        '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>' +
        `<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
        '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor>',
    )
    .join('');
  return (
    `${XML_DECL}<xdr:wsDr ` +
    'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_REL}">` +
    anchors +
    '</xdr:wsDr>'
  );
}

const STYLES =
  `${XML_DECL}<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '<dxfs count="0"/>' +
  '</styleSheet>';

/**
 * Build a single-sheet workbook as a Blob.
 *
 * @param {object}   options
 * @param {string[]} options.header        Header row, rendered bold.
 * @param {Array[]}  options.rows          Data rows; numbers stay numeric.
 * @param {object[]} options.images        { row, column, bytes, alt } — row and
 *                                         column are zero-based data indices.
 * @param {object}   options.imageSize     { width, height } display size in px.
 * @param {number[]} options.columnWidths  Per-column width in characters.
 * @param {number}   options.rowHeight     Data row height in points.
 * @param {string}   options.sheetName
 */
export function buildWorkbook({
  header,
  rows,
  images = [],
  imageSize = { width: 220, height: 110 },
  columnWidths = [],
  rowHeight,
  sheetName = 'Results',
}) {
  const pictures = images.filter((image) => image?.bytes?.length);
  const entries = [
    {
      name: '[Content_Types].xml',
      data:
        `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        (pictures.length
          ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
          : '') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        `${XML_DECL}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
        `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
        '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS_REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${NS_REL}/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    { name: 'xl/styles.xml', data: STYLES },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: sheetXml({ header, rows, columnWidths, rowHeight, hasDrawing: !!pictures.length }),
    },
  ];
  if (pictures.length) {
    entries.push(
      {
        name: 'xl/worksheets/_rels/sheet1.xml.rels',
        data:
          `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="${NS_REL}/drawing" Target="../drawings/drawing1.xml"/>` +
          '</Relationships>',
      },
      { name: 'xl/drawings/drawing1.xml', data: drawingXml(pictures, imageSize) },
      {
        name: 'xl/drawings/_rels/drawing1.xml.rels',
        data:
          `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          pictures
            .map(
              (picture, i) =>
                `<Relationship Id="rId${i + 1}" Type="${NS_REL}/image" Target="../media/image${i + 1}.png"/>`,
            )
            .join('') +
          '</Relationships>',
      },
      ...pictures.map((picture, i) => ({
        name: `xl/media/image${i + 1}.png`,
        data: picture.bytes,
      })),
    );
  }
  return zip(entries);
}
