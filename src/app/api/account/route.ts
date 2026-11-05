import { NextResponse } from "next/server";
import { currentUser, checkOrigin, logout } from "@/lib/auth";
import { db } from "@/lib/db";
import { hash, compare } from "bcryptjs";
import { z } from "zod";
const password = z
  .string()
  .min(16)
  .refine(
    (v) => Buffer.byteLength(v) <= 72,
    "Password must be at most 72 bytes",
  );
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  try {
    checkOrigin(request);
    const input = z
      .object({
        currentPassword: z.string().min(1).max(128),
        newPassword: password,
      })
      .parse(await request.json());
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await compare(input.currentPassword, stored.passwordHash)))
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 },
      );
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hash(input.newPassword, 12) },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.auditLog.create({
        data: {
          action: "PASSWORD_CHANGE",
          reference: user.id,
          actorId: user.id,
          detail: "Password changed; all account sessions revoked",
        },
      });
    });
    await logout();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? e.issues.map((x) => x.message).join("; ")
            : "Unable to change password",
      },
      { status: 400 },
    );
  }
}
