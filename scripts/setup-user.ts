import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
const db = new PrismaClient();
async function main() {
  const email = process.env.SETUP_EMAIL?.trim().toLowerCase();
  const password = process.env.SETUP_PASSWORD;
  if (
    !email ||
    !email.includes("@") ||
    !password ||
    password.length < 6 ||
    Buffer.byteLength(password) > 72
  )
    throw new Error(
      "Set SETUP_EMAIL and SETUP_PASSWORD (at least 6 characters, at most 72 bytes) in your environment",
    );
  if (await db.user.count())
    throw new Error(
      "An owner already exists. Use the documented password reset procedure.",
    );
  await db.user.create({
    data: {
      id: "owner",
      email,
      role: "ADMIN",
      passwordHash: await hash(password, 12),
    },
  });
  console.log("Owner created. Remove SETUP_PASSWORD from the environment.");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
