import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { currentUser, checkOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { InventoryError } from "@/lib/errors";
import { manufacturerProductSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  if (user.role !== "MANUFACTURER")
    return NextResponse.json(
      { error: "Manufacturer access required" },
      { status: 403 },
    );
  try {
    checkOrigin(request);
    const values = manufacturerProductSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const settings = await tx.settings.findUnique({
        where: { id: 1 },
        select: { minStock: true },
      });
      const product = await tx.product.create({
        data: {
          ...values,
          sku: values.sku || null,
          barcode: values.barcode || null,
          category: values.category || null,
          unit: "pcs",
          purchasePrice: "0",
          sellingPrice: "0",
          minStock: settings?.minStock.toString() ?? "5",
        },
      });
      await tx.auditLog.create({
        data: {
          action: "MANUFACTURER_PRODUCT_CREATE",
          reference: product.id,
          actorId: user.id,
          detail: JSON.stringify({
            name: values.name,
            sku: values.sku || null,
            barcode: values.barcode || null,
            category: values.category || null,
          }),
        },
      });
      return { id: product.id };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError)
      return NextResponse.json(
        { error: e.issues.map((issue) => issue.message).join("; ") },
        { status: 400 },
      );
    if (e instanceof InventoryError)
      return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof Prisma.PrismaClientKnownRequestError)
      return NextResponse.json(
        {
          error:
            e.code === "P2002"
              ? "SKU or barcode already exists"
              : "Unable to create product",
        },
        { status: e.code === "P2002" ? 409 : 503 },
      );
    console.error(
      "Manufacturer product creation failed",
      e instanceof Error ? e.name : "error",
    );
    return NextResponse.json(
      { error: "Unable to create product. Please retry." },
      { status: 503 },
    );
  }
}
