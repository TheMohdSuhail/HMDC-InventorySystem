import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { checkOrigin, createSession, logout } from "@/lib/auth";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const data = z
      .object({
        email: z.string().email().max(191),
        password: z.string().min(1).max(128),
      })
      .parse(await request.json());
    // Account-wide database-backed throttling is effective across serverless instances.
    const key = createHash("sha256").update("single-user-login").digest("hex");
    const allowed = await db.$transaction(async (tx) => {
      await tx.loginAttempt.upsert({
        where: { key },
        create: { key, count: 0, resetAt: new Date(Date.now() + 15 * 60000) },
        update: {},
      });
      await tx.$queryRaw`SELECT \`key\` FROM LoginAttempt WHERE \`key\` = ${key} FOR UPDATE`;
      let state = (await tx.loginAttempt.findUnique({ where: { key } }))!;
      if (state.resetAt < new Date())
        state = await tx.loginAttempt.update({
          where: { key },
          data: { count: 0, resetAt: new Date(Date.now() + 15 * 60000) },
        });
      if (state.count >= 10) return false;
      await tx.loginAttempt.update({
        where: { key },
        data: { count: { increment: 1 } },
      });
      return true;
    });
    if (!allowed)
      return NextResponse.json(
        { error: "Too many attempts. Try again in 15 minutes." },
        { status: 429 },
      );
    const user = await db.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });
    // A valid bcrypt hash also equalizes work for unknown accounts.
    const valid = await compare(
      data.password,
      user?.passwordHash ??
        "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxDOOZkQjXNVXn9FeQKYlWnWDG6",
    );
    if (!user || !user.active || !valid)
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return NextResponse.json(
        { error: "Enter a valid email and password" },
        { status: 400 },
      );
    console.error("Login failed", e instanceof Error ? e.name : "error");
    return NextResponse.json(
      { error: "Login unavailable. Check server configuration." },
      { status: 503 },
    );
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    await logout();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to log out" }, { status: 400 });
  }
}
