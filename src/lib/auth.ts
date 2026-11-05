import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { sealData, unsealData } from "iron-session";
import { InventoryError } from "./errors";
export const cookieName = "inventory_session";
function digest(token: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Configure AUTH_SECRET with at least 32 characters");
  return createHash("sha256")
    .update(token + secret)
    .digest("hex");
}
export async function currentUser() {
  const sealed = (await cookies()).get(cookieName)?.value;
  if (!sealed) return null;
  const { token } = await unsealData<{ token?: string }>(sealed, {
    password: process.env.AUTH_SECRET || "",
    ttl: 12 * 60 * 60,
  });
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { id: digest(token) },
    include: { user: true },
  });
  return session && session.user.active && session.expiresAt > new Date()
    ? {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role,
      }
    : null;
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await db.session.create({ data: { id: digest(token), userId, expiresAt } });
  const sealed = await sealData(
    { token },
    { password: process.env.AUTH_SECRET!, ttl: 12 * 60 * 60 },
  );
  (await cookies()).set(cookieName, sealed, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}
export async function logout() {
  const jar = await cookies();
  const sealed = jar.get(cookieName)?.value;
  const token = sealed
    ? (
        await unsealData<{ token?: string }>(sealed, {
          password: process.env.AUTH_SECRET || "",
          ttl: 12 * 60 * 60,
        })
      ).token
    : undefined;
  if (token) await db.session.deleteMany({ where: { id: digest(token) } });
  jar.delete(cookieName);
}
export function checkOrigin(request: Request) {
  const expected = process.env.APP_URL;
  if (!expected) throw new Error("Configure APP_URL");
  if (request.headers.get("origin") !== new URL(expected).origin)
    throw new InventoryError("Invalid request origin");
}
