import { excelResponse } from "@/lib/excel";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, checkOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/errors";
import { importColumns, validateImport } from "@/lib/product-import";
import { importProducts } from "@/lib/product-import-service";
import { readImportFile } from "@/lib/product-import-file";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  if (user.role !== "ADMIN")
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  return excelResponse([], "product-import-template", [...importColumns]);
}
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user)
      return NextResponse.json({ error: "Please log in" }, { status: 401 });
    if (user.role !== "ADMIN")
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    checkOrigin(request);
    if (Number(request.headers.get("content-length") || 0) > 3 * 1024 * 1024)
      return NextResponse.json(
        { error: "File too large. Maximum 2 MB." },
        { status: 413 },
      );
    let rows: unknown;
    let commit = false;
    let requestKey = "";
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        file.size === 0 ||
        file.size > 2 * 1024 * 1024
      )
        throw new InventoryError("Choose an Excel XLSX file up to 2 MB");
      const bytes = Buffer.from(await file.arrayBuffer());
      rows = await readImportFile(file.name, bytes);
    } else {
      const body = z
        .object({
          mode: z.enum(["preview", "commit"]),
          rows: z.unknown(),
          requestKey: z.string().uuid().optional(),
        })
        .parse(await request.json());
      rows = body.rows;
      commit = body.mode === "commit";
      if (commit) requestKey = z.string().uuid().parse(body.requestKey);
    }
    const catalog = await db.product.findMany({
      select: { sku: true, barcode: true },
    });
    const preview = validateImport(rows, catalog);
    // Successful retries must reach the idempotency record even though their identifiers now exist.
    if (commit)
      return NextResponse.json(
        await importProducts(preview.rows, requestKey, user.id),
      );
    return NextResponse.json(preview, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof InventoryError
            ? e.message
            : e instanceof z.ZodError
              ? "Invalid rows or request. Use the template, with at most 200 products."
              : "Unable to read/import products. Check the file and try again.",
      },
      { status: 400 },
    );
  }
}
