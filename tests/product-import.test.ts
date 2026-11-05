import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  parseCsv,
  tableToRows,
  validateImport,
  normalizeImportRow,
  importRowSchema,
  queueProductScan,
} from "../src/lib/product-import";
import { readImportFile } from "../src/lib/product-import-file";
function workbook(numericBarcode = false, formula = false) {
  const cells = [
    ["A1", "name"],
    ["B1", "purchasePrice"],
    ["C1", "sellingPrice"],
    ["D1", "barcode"],
    ["A2", "Tea"],
    ["B2", "80"],
    ["C2", "120"],
    ["D2", "0012345678905"],
  ].map(([ref, value]) =>
    ref === "D2" && numericBarcode
      ? `<c r="${ref}"><v>12345678905</v></c>`
      : `<c r="${ref}" t="inlineStr">${formula && ref === "A2" ? "<f>1+1</f>" : ""}<is><t>${value}</t></is></c>`,
  );
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      "xl/workbook.xml": strToU8(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cells.slice(0, 4).join("")}</row><row r="2">${cells.slice(4).join("")}</row></sheetData></worksheet>`,
      ),
    }),
  );
}
describe("bulk product parsing and validation", () => {
  it("imports quantity-only rows with an optional ISO expiry date", () => {
    const rows = tableToRows([
      ["name", "barcode", "expiryDate"],
      ["Tea", "00123", "2027-12-31"],
    ]);
    expect(validateImport(rows).issues).toEqual([]);
    expect(normalizeImportRow(rows[0]).purchasePrice).toBe("0");
    expect(
      validateImport([{ name: "Tea", expiryDate: "invalid" }]).issues[0].field,
    ).toBe("expiryDate");
  });
  it("queues repeated scans as opening units and preserves leading zeros", () => {
    let rows = queueProductScan([], "00123");
    rows = queueProductScan(rows, "00123");
    rows = queueProductScan(rows, "00456");
    expect(rows).toHaveLength(2);
    expect(rows[0].barcode).toBe("00123");
    expect(rows[0].openingQuantity).toBe("2");
    expect(rows[1].openingQuantity).toBe("1");
  });
  it("rejects rescanning a row with a malformed quantity without mutating the queue", () => {
    const rows = [{ barcode: "00123", openingQuantity: "invalid" }];
    expect(() => queueProductScan(rows, "00123")).toThrow("Fix opening");
    expect(rows[0].openingQuantity).toBe("invalid");
  });
  it("parses BOM, CRLF, quoted commas, multiline notes and escaped quotes", () => {
    const rows = parseCsv(
      '\uFEFFname,purchasePrice,sellingPrice,barcode,notes\r\n"Tea, green",80,120,00123,"line1\nline2 ""quote"""\r\n',
    );
    expect(rows[1][0]).toBe("Tea, green");
    expect(tableToRows(rows)[0].barcode).toBe("00123");
    expect(rows[1][4]).toContain('line2 "quote"');
  });
  it("rejects malformed CSV and too many records", () => {
    expect(() => parseCsv('name\n"oops')).toThrow("Unclosed");
    expect(() =>
      parseCsv("name\n" + Array(201).fill("Tea").join("\n")),
    ).toThrow("Maximum");
  });
  it("validates required headers and duplicates", () => {
    expect(tableToRows([["name"], ["Tea"]])[0].name).toBe("Tea");
    expect(() =>
      tableToRows([
        ["name", "purchasePrice", "sellingPrice", "name"],
        ["Tea", "1", "2", "Tea"],
      ]),
    ).toThrow("Duplicate");
  });
  it("accepts aliases and rejects extra unnamed row values", () => {
    expect(
      tableToRows([
        ["Product name", "Purchase price", "Selling price", "Opening stock"],
        ["Tea", "80", "120", "2"],
      ])[0].openingQuantity,
    ).toBe("2");
    expect(() =>
      tableToRows([
        ["name", "purchasePrice", "sellingPrice"],
        ["Tea", "1", "2", "extra"],
      ]),
    ).toThrow("more values");
  });
  it("flags duplicate existing and within-batch identifiers case-insensitively", () => {
    const row = {
      name: "Tea",
      purchasePrice: "80",
      sellingPrice: "120",
      barcode: "00123",
      sku: "tea",
    };
    const result = validateImport(
      [row, { ...row, sku: "TEA" }],
      [{ sku: null, barcode: "00123" }],
    );
    expect(result.issues.some((i) => i.field === "barcode")).toBe(true);
    expect(result.issues.some((i) => i.row === 2 && i.field === "sku")).toBe(
      true,
    );
  });
  it("defaults zero opening stock, unit, threshold and active status", () => {
    const row = importRowSchema.parse(
      normalizeImportRow({
        name: "Tea",
        purchasePrice: "80",
        sellingPrice: "120",
        openingQuantity: "0.000",
        minStock: "",
      }),
    );
    expect(row.unit).toBe("pcs");
    expect(row.active).toBe(true);
    expect(row.minStock).toBeUndefined();
  });
  it("rejects negative or over-precision quantities/prices and invalid booleans", () => {
    const row = { name: "Tea", purchasePrice: "80", sellingPrice: "120" };
    for (const patch of [
      { openingQuantity: "-1" },
      { openingQuantity: "1.0001" },
      { active: "maybe" },
    ])
      expect(
        validateImport([{ ...row, ...patch }]).issues.length,
      ).toBeGreaterThan(0);
  });
  it("reads a real XLSX first sheet preserving textual leading zeros", async () => {
    const rows = await readImportFile("products.xlsx", workbook());
    expect(rows[0]).toMatchObject({
      name: "Tea",
      barcode: "0012345678905",
      purchasePrice: "80",
    });
  });
  it("rejects Excel numeric barcodes and formulas", async () => {
    await expect(
      readImportFile("products.xlsx", workbook(true)),
    ).rejects.toThrow("Text");
    await expect(
      readImportFile("products.xlsx", workbook(false, true)),
    ).rejects.toThrow("formulas");
  });
  it("rejects legacy XLS, oversized files and expanded workbook bombs", async () => {
    await expect(
      readImportFile("products.xls", Buffer.from("x")),
    ).rejects.toThrow("Supported");
    await expect(
      readImportFile("products.csv", Buffer.alloc(2 * 1024 * 1024 + 1)),
    ).rejects.toThrow("2 MB");
    const zip = Buffer.from(
      zipSync({ "xl/worksheets/sheet1.xml": new Uint8Array(9 * 1024 * 1024) }),
    );
    await expect(readImportFile("products.xlsx", zip)).rejects.toThrow(
      "decompression",
    );
  });
});
