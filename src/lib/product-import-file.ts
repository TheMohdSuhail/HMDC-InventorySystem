import { unzipSync, strFromU8 } from "fflate";
import { readSheet } from "read-excel-file/node";
import { InventoryError } from "./errors";
import { tableToRows } from "./product-import";
export async function readImportFile(name: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > 2 * 1024 * 1024)
    throw new InventoryError("Choose an Excel XLSX file up to 2 MB");
  if (!name.toLowerCase().endsWith(".xlsx"))
    throw new InventoryError(
      "Supported files: .xlsx. Save older Excel files as .xlsx.",
    );
  let total = 0,
    count = 0;
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      total += entry.originalSize;
      count++;
      if (
        total > 16 * 1024 * 1024 ||
        entry.originalSize > 8 * 1024 * 1024 ||
        count > 128
      )
        throw new InventoryError("Workbook is too large after decompression");
      return entry.name.startsWith("xl/worksheets/");
    },
  });
  if (
    Object.values(entries).some((value) =>
      /<(?:\w+:)?f[\s>]/.test(strFromU8(value)),
    )
  )
    throw new InventoryError(
      "Excel formulas are not supported. Paste values only before importing.",
    );
  return tableToRows(await readSheet(bytes, 1));
}
