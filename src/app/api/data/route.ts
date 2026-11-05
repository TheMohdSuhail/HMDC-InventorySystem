import { workspace } from "@/lib/workspace";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, checkOrigin } from "@/lib/auth";
import {
  productSchema,
  supplierSchema,
  settingsSchema,
  operationSchema,
} from "@/lib/validation";
import { execute } from "@/lib/inventory";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { authorizeOperation } from "@/lib/permissions";
import { InventoryError } from "@/lib/errors";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await currentUser();
    if (!user)
      return NextResponse.json({ error: "Please log in" }, { status: 401 });
    const result = await workspace(user);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("Data load failed", e instanceof Error ? e.name : "error");
    return NextResponse.json(
      { error: "Database unavailable. Verify configuration and migrations." },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user)
      return NextResponse.json({ error: "Please log in" }, { status: 401 });
    checkOrigin(request);
    if (user.role !== "ADMIN")
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    const body = await request.json();
    if (
      ["product", "supplier", "settings"].includes(body.action) &&
      user.role !== "ADMIN"
    )
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    if (body.action === "product") {
      const values = productSchema.parse({
        ...body.data,
        purchasePrice: "0",
        sellingPrice: "0",
      });
      // Catalog edits preserve historical monetary values.
      if (body.id) {
        const old = await db.product.findUnique({
          where: { id: String(body.id) },
        });
        if (old) {
          values.purchasePrice = old.purchasePrice.toString();
          values.sellingPrice = old.sellingPrice.toString();
        }
      }
      const id = z.string().max(64).optional().parse(body.id);
      const result = await db.$transaction(async (tx) => {
        const minStock =
          values.minStock ??
          (
            await tx.settings.findUnique({ where: { id: 1 } })
          )?.minStock.toString() ??
          "5";
        const data = {
          ...values,
          expiryDate: values.expiryDate
            ? new Date(values.expiryDate + "T00:00:00.000Z")
            : null,
          minStock,
          sku: values.sku || null,
          barcode: values.barcode || null,
        };
        if (id)
          await tx.$queryRaw`SELECT id FROM Product WHERE id = ${id} FOR UPDATE`;
        const p = id
          ? await tx.product.update({ where: { id }, data })
          : await tx.product.create({ data });
        await tx.auditLog.create({
          data: {
            action: id ? "PRODUCT_EDIT" : "PRODUCT_CREATE",
            reference: p.id,
            actorId: user.id,
            detail: JSON.stringify(data),
          },
        });
        return { id: p.id };
      });
      return NextResponse.json(result);
    }
    if (body.action === "supplier") {
      const values = supplierSchema.parse(body.data);
      const id = z.string().max(64).optional().parse(body.id);
      return NextResponse.json(
        await db.$transaction(async (tx) => {
          const s = id
            ? await tx.supplier.update({ where: { id }, data: values })
            : await tx.supplier.create({ data: values });
          await tx.auditLog.create({
            data: {
              action: "SUPPLIER_SAVE",
              reference: s.id,
              actorId: user.id,
              detail: JSON.stringify(values),
            },
          });
          return { id: s.id };
        }),
      );
    }
    if (body.action === "settings") {
      const values = settingsSchema.parse(body.data);
      return NextResponse.json(
        await db.$transaction(async (tx) => {
          const s = await tx.settings.upsert({
            where: { id: 1 },
            create: { id: 1, ...values },
            update: values,
          });
          await tx.auditLog.create({
            data: {
              action: "SETTINGS",
              reference: "1",
              actorId: user.id,
              detail: JSON.stringify(values),
            },
          });
          return s;
        }),
      );
    }
    if (body.action === "payment")
      return NextResponse.json(
        { error: "Money operations are disabled" },
        { status: 403 },
      );
    const input = operationSchema.parse(body);
    try {
      authorizeOperation(user.role, input);
    } catch {
      return NextResponse.json(
        { error: "Admin access required for this operation" },
        { status: 403 },
      );
    }
    return NextResponse.json(await execute(input, user.id, user.role));
  } catch (e) {
    if (e instanceof z.ZodError)
      return NextResponse.json(
        {
          error: e.issues
            .map((x) => `${x.path.join(".")}: ${x.message}`)
            .join("; "),
        },
        { status: 400 },
      );
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      return NextResponse.json(
        {
          error:
            e.code === "P2002"
              ? "SKU, barcode, or request already exists"
              : e.code === "P2025"
                ? "Record not found"
                : "Database operation failed; refresh and retry",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error:
          e instanceof InventoryError
            ? e.message
            : "Operation unavailable. Check server configuration and retry.",
      },
      { status: e instanceof InventoryError ? 400 : 503 },
    );
  }
}
