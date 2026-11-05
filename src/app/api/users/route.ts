import { NextResponse } from "next/server";
import { currentUser, checkOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { hash } from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { InventoryError } from "@/lib/errors";
const schema = z.object({
  id: z.string().max(64).optional(),
  email: z
    .string()
    .email()
    .max(191)
    .transform((s) => s.toLowerCase()),
  role: z.enum(["ADMIN", "BRANCH_MANAGER", "MANUFACTURER"]),
  active: z.boolean(),
  password: z
    .string()
    .min(16)
    .refine(
      (v) => Buffer.byteLength(v) <= 72,
      "Password must be at most 72 bytes",
    )
    .optional(),
});
export async function GET() {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  if (user.role !== "ADMIN")
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  return NextResponse.json(
    await db.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Please log in" }, { status: 401 });
  if (user.role !== "ADMIN")
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  try {
    checkOrigin(request);
    const input = schema.parse(await request.json());
    if (input.id === user.id && (!input.active || input.role !== "ADMIN"))
      throw new InventoryError(
        "You cannot deactivate or demote your own admin account",
      );
    if (!input.id && !input.password)
      throw new InventoryError("A password is required for a new account");
    const result = await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM User ORDER BY id FOR UPDATE`;
        if (input.id) {
          const old = await tx.user.findUnique({ where: { id: input.id } });
          if (
            old &&
            old.role !== input.role &&
            (await tx.locationBalance.count({
              where: {
                ownerId: input.id,
                OR: [
                  { quantity: { gt: 0 } },
                  { damaged: { gt: 0 } },
                  { expired: { gt: 0 } },
                  { quarantined: { gt: 0 } },
                ],
              },
            })) > 0
          )
            throw new InventoryError(
              "Return or dispatch this account's stock before changing its role",
            );
        }
        const values = {
          email: input.email,
          role: input.role,
          active: input.active,
          ...(input.password
            ? { passwordHash: await hash(input.password, 12) }
            : {}),
        };
        const target = input.id
          ? await tx.user.update({ where: { id: input.id }, data: values })
          : await tx.user.create({
              data: { ...values, passwordHash: values.passwordHash! },
            });
        if (
          (await tx.user.count({ where: { role: "ADMIN", active: true } })) ===
          0
        )
          throw new InventoryError("At least one active admin must remain");
        if (input.id)
          await tx.session.deleteMany({ where: { userId: input.id } });
        await tx.auditLog.create({
          data: {
            action: input.id ? "USER_UPDATE" : "USER_CREATE",
            reference: target.id,
            actorId: user.id,
            detail: JSON.stringify({
              email: input.email,
              role: input.role,
              active: input.active,
              passwordChanged: !!input.password,
            }),
          },
        });
        return { id: target.id };
      },
      { isolationLevel: "Serializable", timeout: 20000 },
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? e.issues.map((x) => x.message).join("; ")
            : e instanceof Prisma.PrismaClientKnownRequestError
              ? "Email already exists or account cannot be updated"
              : e instanceof InventoryError
                ? e.message
                : "Unable to update account",
      },
      { status: 400 },
    );
  }
}
