import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { currentUser, checkOrigin } from "@/lib/auth";
import { InventoryError } from "@/lib/errors";
import {
  deleteOrder,
  findOrder,
  listOrders,
  scanToOrder,
  searchOrders,
  setOrderStatus,
  updateOrder,
} from "@/lib/orders";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function failure(e: unknown) {
  const error =
    e instanceof InventoryError
      ? e.message
      : e instanceof z.ZodError
        ? e.issues.map((i) => i.message).join("; ")
        : e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
          ? "This order ID is already used"
          : "Unable to save. Refresh and retry.";
  if (!(e instanceof InventoryError || e instanceof z.ZodError))
    console.error("Order operation failed", e instanceof Error ? e.name : "error");
  return NextResponse.json({ error }, { status: 400 });
}

/** GET /api/orders?no=TRL1023 — load an existing order (or null if new). */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("list"))
      return NextResponse.json(
        await listOrders(Object.fromEntries(params), user),
        { headers: { "Cache-Control": "no-store" } },
      );
    if (params.has("search"))
      return NextResponse.json(
        {
          orders: await searchOrders(
            {
              q: params.get("q") || "",
              status: params.get("status") || "",
              member: params.get("member") || "",
            },
            user,
          ),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    const no = params.get("no") || "";
    return NextResponse.json(
      { order: await findOrder(user, no) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

/** POST { action: "scan" | "update" | "delete", ... } */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  try {
    checkOrigin(request);
    const body = await request.json();
    if (body?.action === "scan")
      return NextResponse.json(await scanToOrder(body, user));
    if (body?.action === "update")
      return NextResponse.json(await updateOrder(body, user));
    if (body?.action === "status")
      return NextResponse.json(await setOrderStatus(body, user));
    if (body?.action === "delete")
      return NextResponse.json(await deleteOrder(body, user));
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return failure(e);
  }
}
