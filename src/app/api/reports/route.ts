import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { workspace } from "@/lib/workspace";
import { excelResponse } from "@/lib/excel";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  if (user.role === "MANUFACTURER")
    return NextResponse.json(
      { error: "Reports are unavailable for manufacturer accounts" },
      { status: 403 },
    );
  const data = await workspace(user);
  const rows = data.products.flatMap((p) =>
    "stock" in p
      ? [
          {
            id: p.id,
            name: p.name,
            barcode: p.barcode,
            unit: p.unit,
            quantity: p.stock,
          },
        ]
      : [],
  );
  if (
    ["xlsx", "excel", "csv"].includes(
      new URL(request.url).searchParams.get("format") || "",
    )
  )
    return excelResponse(rows, "stock-quantities");
  return NextResponse.json(
    { stock: rows, operations: data.events },
    { headers: { "Cache-Control": "no-store" } },
  );
}
