import { it, expect } from "vitest";
import { readSheet } from "read-excel-file/node";
import { excelFile, excelResponse, excelType } from "../src/lib/excel";
import { readImportFile } from "../src/lib/product-import-file";
import { importColumns } from "../src/lib/product-import";
it("writes real XLSX preserving barcode zeros, safe text, dates and numeric quantities", async () => {
  const bytes = excelFile([
    {
      name: '=HYPERLINK("bad") & Tea',
      barcode: "0012345678905",
      quantity: "2.5",
      expiryDate: new Date("2027-12-31"),
    },
  ]);
  const sheet = await readSheet(Buffer.from(bytes), 1);
  expect(sheet[1]).toEqual([
    '=HYPERLINK("bad") & Tea',
    "0012345678905",
    2.5,
    "2027-12-31",
  ]);
  const response = excelResponse([], "template", [...importColumns]);
  expect(response.headers.get("Content-Type")).toBe(excelType);
  expect(response.headers.get("Content-Disposition")).toContain(
    "template.xlsx",
  );
  expect(
    (await readSheet(Buffer.from(await response.arrayBuffer()), 1))[0],
  ).toEqual([...importColumns]);
});
it("round-trips quantity-only Excel import and rejects CSV upload", async () => {
  const bytes = excelFile([
    {
      name: "Tea",
      barcode: "00123",
      openingQuantity: "3",
      expiryDate: "2027-12-31",
    },
  ]);
  expect(
    (await readImportFile("products.xlsx", Buffer.from(bytes)))[0],
  ).toMatchObject({
    barcode: "00123",
    openingQuantity: "3",
    expiryDate: "2027-12-31",
  });
  await expect(
    readImportFile("products.csv", Buffer.from("name\nTea")),
  ).rejects.toThrow("Supported");
});
