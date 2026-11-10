import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, checkOrigin } from "@/lib/auth";
import { InventoryError } from "@/lib/errors";
import { deleteTeamMember, saveTeamMember } from "@/lib/orders";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  if (user.role !== "ADMIN")
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  try {
    checkOrigin(request);
    const body = await request.json();
    return NextResponse.json(
      body?.action === "delete"
        ? await deleteTeamMember(body, user)
        : await saveTeamMember(body, user),
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof InventoryError
            ? e.message
            : e instanceof z.ZodError
              ? e.issues.map((i) => i.message).join("; ")
              : "Unable to save team member",
      },
      { status: 400 },
    );
  }
}
