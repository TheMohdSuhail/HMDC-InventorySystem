import { currentUser } from "@/lib/auth";
import { workspace } from "@/lib/workspace";
import { excelResponse } from "@/lib/excel";
import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  if (user.role === "MANUFACTURER")
    return NextResponse.json(
      { error: "Exports are unavailable for manufacturer accounts" },
      { status: 403 },
    );
  const type = new URL(request.url).searchParams.get("type") || "products";
  const data = await workspace(user);
  let rows: Record<string, unknown>[];
  if (["products", "balances", "stock"].includes(type)) rows = data.products;
  else if (["movements", "operations"].includes(type))
    rows = data.events.flatMap((e) =>
      e.items.map((i) => ({
        date: e.createdAt,
        reference: e.id,
        type: e.type,
        condition: e.condition,
        location: e.ownerId,
        productId: i.productId,
        quantity: i.quantity,
        processed: i.processed,
        boxes: i.boxes,
        piecesPerBox: i.piecesPerBox,
        loosePieces: i.loosePieces,
        notes: e.notes,
      })),
    );
  else if (type === "suppliers" && user.role === "ADMIN") rows = data.suppliers;
  else if (type === "sales" && user.role === "ADMIN")
    rows = data.legacySales.flatMap((s) =>
      s.items.map((i) => ({
        number: s.number,
        date: s.createdAt,
        status: s.status,
        ...i,
      })),
    );
  else
    return NextResponse.json(
      { error: "Export unavailable for this role" },
      { status: 403 },
    );
  return excelResponse(rows, `inventory-${type}`);
}
