import { zipSync, strToU8 } from "fflate";

const escapeXml = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const column = (n: number): string =>
  n < 26
    ? String.fromCharCode(65 + n)
    : column(Math.floor(n / 26) - 1) + column(n % 26);
const numeric = new Set([
  "stock",
  "quantity",
  "damaged",
  "expired",
  "quarantined",
  "minStock",
  "processed",
  "boxes",
  "piecesPerBox",
  "loosePieces",
  "returned",
  "openingQuantity",
]);
export const excelType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Inline string cells preserve identifiers and prevent formula execution, including =,+,-,@ prefixes.
export function excelFile(
  rows: Record<string, unknown>[],
  columns = rows.length ? Object.keys(rows[0]) : ["No records"],
) {
  const text = (ref: string, value: string, header = false) =>
    `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  const header = `<row r="1">${columns.map((key, i) => text(`${column(i)}1`, key, true)).join("")}</row>`;
  const body = rows
    .map(
      (row, index) =>
        `<row r="${index + 2}">${columns
          .map((key, i) => {
            const value = row[key];
            const ref = `${column(i)}${index + 2}`;
            const string =
              value == null
                ? ""
                : value instanceof Date
                  ? key === "expiryDate"
                    ? value.toISOString().slice(0, 10)
                    : value.toISOString()
                  : typeof value === "object" && !("toFixed" in value)
                    ? JSON.stringify(value)
                    : String(value);
            return numeric.has(key) &&
              /^-?\d+(\.\d+)?$/.test(string) &&
              Number.isFinite(Number(string))
              ? `<c r="${ref}" t="n"><v>${string}</v></c>`
              : text(ref, string);
          })
          .join("")}</row>`,
    )
    .join("");
  const files: Record<string, string> = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventory" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml":
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0"/><xf fontId="1" applyFont="1"/><xf fontId="0" numFmtId="49" applyNumberFormat="1"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${columns.map((key, i) => `<col min="${i + 1}" max="${i + 1}" width="22" customWidth="1"${numeric.has(key) ? "" : ' style="2"'}/>`).join("")}</cols><sheetData>${header}${body}</sheetData><autoFilter ref="A1:${column(columns.length - 1)}${Math.max(1, rows.length + 1)}"/></worksheet>`,
  };
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, value]) => [
        name,
        strToU8(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + value,
        ),
      ]),
    ),
  );
}
export function excelResponse(
  rows: Record<string, unknown>[],
  filename: string,
  columns?: string[],
) {
  return new Response(Buffer.from(excelFile(rows, columns)), {
    headers: {
      "Content-Type": excelType,
      "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
