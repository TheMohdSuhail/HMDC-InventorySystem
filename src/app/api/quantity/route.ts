import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, checkOrigin } from "@/lib/auth";
import {
  executeQuantity,
  quantitySchema,
  authorizeQuantity,
} from "@/lib/quantity";
import { InventoryError } from "@/lib/errors";
export const maxDuration = 60;
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  try {
    checkOrigin(request);
    const input = quantitySchema.parse(await request.json());
    try {
      authorizeQuantity(user, input);
    } catch {
      return NextResponse.json(
        { error: "Operation not permitted for this role" },
        { status: 403 },
      );
    }
    return NextResponse.json(await executeQuantity(input, user));
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof InventoryError
            ? e.message
            : e instanceof z.ZodError
              ? e.issues
                  .map((i) => `${i.path.join(".")}: ${i.message}`)
                  .join("; ")
              : "Unable to save. Refresh and retry.",
      },
      { status: 400 },
    );
  }
}
