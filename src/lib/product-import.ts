import { z } from "zod";
import { InventoryError } from "./errors";
import { D } from "./math";
import { productSchema } from "./validation";
export const MAX_IMPORT_ROWS = 200;
export const importColumns = [
  "name",
  "sku",
  "barcode",
  "category",
  "expiryDate",
  "unit",
  "minStock",
  "openingQuantity",
  "notes",
  "active",
] as const;
export const importRowSchema = productSchema.extend({
  openingQuantity: z
    .string()
    .regex(
      /^\d{1,9}(\.\d{1,3})?$/,
      "Use a non-negative quantity with up to 3 decimal places",
    )
    .default("0"),
});
export type ImportRow = z.infer<typeof importRowSchema>;
export type ImportIssue = { row: number; field: string; message: string };
export type ImportPreview = {
  rows: Record<string, string>[];
  issues: ImportIssue[];
  validCount: number;
};
const aliases: Record<string, string> = {
  expiry: "expiryDate",
  expirydate: "expiryDate",
  productname: "name",
  product: "name",
  cost: "purchasePrice",
  costprice: "purchasePrice",
  purchaseprice: "purchasePrice",
  sellingprice: "sellingPrice",
  saleprice: "sellingPrice",
  minimumstock: "minStock",
  minstock: "minStock",
  openingstock: "openingQuantity",
  openingquantity: "openingQuantity",
  quantity: "openingQuantity",
  unitofmeasurement: "unit",
};
export const identifier = (s: string) =>
  s.trim().normalize("NFKC").toLocaleLowerCase("en");
export function queueProductScan(
  current: Record<string, string>[],
  code: string,
) {
  const index = current.findIndex(
    (r) => identifier(r.barcode || "") === identifier(code),
  );
  if (index >= 0) {
    const value = current[index].openingQuantity || "0";
    if (!importRowSchema.shape.openingQuantity.safeParse(value).success)
      throw new InventoryError(
        `Fix opening quantity in row ${index + 1} before scanning it again`,
      );
    const next = D(value).plus(1).toString();
    if (!importRowSchema.shape.openingQuantity.safeParse(next).success)
      throw new InventoryError("Opening quantity is too large");
    return current.map((r, i) =>
      i === index ? { ...r, openingQuantity: next } : r,
    );
  }
  if (current.length >= MAX_IMPORT_ROWS)
    throw new InventoryError("Save this batch before scanning more products");
  return [
    ...current,
    {
      name: "",
      barcode: code,
      sku: "",
      purchasePrice: "0",
      sellingPrice: "0",
      openingQuantity: "1",
      unit: "pcs",
    },
  ];
}
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "");
  const finish = () => {
    row.push(cell);
    if (row.some((v) => v.trim())) rows.push(row);
    row = [];
    cell = "";
    closed = false;
    if (rows.length > MAX_IMPORT_ROWS + 1)
      throw new InventoryError(
        `Maximum ${MAX_IMPORT_ROWS} products per import`,
      );
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (c === '"') {
      if (cell || closed) throw new InventoryError("Invalid CSV quoting");
      quoted = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      closed = false;
      if (row.length > 30) throw new InventoryError("Too many columns");
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      finish();
    } else {
      if (closed && c.trim())
        throw new InventoryError("Unexpected text after quoted CSV field");
      if (!closed) cell += c;
    }
  }
  if (quoted) throw new InventoryError("Unclosed quoted CSV field");
  if (cell || row.length || closed) finish();
  return rows;
}
export function tableToRows(table: unknown[][]): Record<string, string>[] {
  if (table.length < 2)
    throw new InventoryError("Add column headings and at least one product");
  if (table.length > MAX_IMPORT_ROWS + 1)
    throw new InventoryError(`Maximum ${MAX_IMPORT_ROWS} products per import`);
  const headers = table[0].map((v) => {
    const name = String(v ?? "")
      .trim()
      .replace(/[\s_\-]/g, "")
      .toLowerCase();
    return (
      aliases[name] ??
      importColumns.find((c) => c.toLowerCase() === name) ??
      name
    );
  });
  if (headers.length > 30) throw new InventoryError("Too many columns");
  const supplied = headers.filter(Boolean);
  if (new Set(supplied).size !== supplied.length)
    throw new InventoryError("Duplicate column headings");
  for (const required of ["name"])
    if (!headers.includes(required))
      throw new InventoryError(`Missing column: ${required}`);
  for (const h of supplied)
    if (
      !importColumns.includes(h as (typeof importColumns)[number]) &&
      !["purchasePrice", "sellingPrice"].includes(h)
    )
      throw new InventoryError(
        `Unsupported column: ${h}. Use the downloadable template.`,
      );
  return table
    .slice(1)
    .filter((r) =>
      r.some((v) => v !== null && v !== undefined && String(v).trim()),
    )
    .map((r, index) => {
      if (
        r.length > headers.length &&
        r.slice(headers.length).some((v) => v !== null && String(v).trim())
      )
        throw new InventoryError(
          `Row ${index + 2}: more values than column headings`,
        );
      return Object.fromEntries(
        headers.filter(Boolean).map((h) => {
          const value = r[headers.indexOf(h)];
          if (["sku", "barcode"].includes(h) && typeof value === "number")
            throw new InventoryError(
              `Row ${index + 2}: format ${h} as Text in Excel to preserve leading zeros`,
            );
          return [
            h,
            value instanceof Date && h === "expiryDate"
              ? value.toISOString().slice(0, 10)
              : String(value ?? "").trim(),
          ];
        }),
      );
    });
}
export function validateImport(
  rawRows: unknown,
  existing: { sku: string | null; barcode: string | null }[] = [],
): ImportPreview {
  const rows = z
    .array(z.record(z.string().max(2000)))
    .min(1)
    .max(MAX_IMPORT_ROWS)
    .parse(rawRows);
  const issues: ImportIssue[] = [];
  const skus = new Set(
    existing.flatMap((p) => (p.sku ? [identifier(p.sku)] : [])),
  );
  const barcodes = new Set(
    existing.flatMap((p) => (p.barcode ? [identifier(p.barcode)] : [])),
  );
  rows.forEach((raw, index) => {
    const row = normalizeImportRow(raw);
    const parsed = importRowSchema.safeParse(row);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        issues.push({
          row: index + 1,
          field: issue.path.join("."),
          message: issue.message,
        });
    for (const [field, seen] of [
      ["sku", skus],
      ["barcode", barcodes],
    ] as const) {
      const code = raw[field]?.trim();
      if (!code) continue;
      const normalized = identifier(code);
      if (seen.has(normalized))
        issues.push({
          row: index + 1,
          field,
          message: `Duplicate ${field}: already in the catalog or this batch`,
        });
      seen.add(normalized);
    }
  });
  return {
    rows,
    issues,
    validCount: rows.length - new Set(issues.map((i) => i.row)).size,
  };
}
export function normalizeImportRow(raw: Record<string, string>) {
  return {
    ...raw,
    purchasePrice: "0",
    sellingPrice: "0",
    unit: raw.unit || "pcs",
    openingQuantity: raw.openingQuantity || "0",
    minStock: raw.minStock || undefined,
    active:
      raw.active === undefined || raw.active === ""
        ? true
        : ["true", "yes", "1"].includes(raw.active.toLowerCase())
          ? true
          : ["false", "no", "0"].includes(raw.active.toLowerCase())
            ? false
            : raw.active,
  };
}
