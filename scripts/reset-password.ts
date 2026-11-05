import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
const db = new PrismaClient();
async function main() {
  const password = process.env.SETUP_PASSWORD;
  if (!password || password.length < 6 || Buffer.byteLength(password) > 72)
    throw new Error("Set SETUP_PASSWORD to at least 6 characters and at most 72 bytes");
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: "owner" },
      data: { passwordHash: await hash(password, 12) },
    });
    await tx.session.deleteMany();
    await tx.auditLog.create({
      data: {
        action: "PASSWORD_RESET",
        reference: "owner",
        detail:
          "Password reset through administrative CLI; all sessions revoked",
      },
    });
  });
  console.log("Password changed; all sessions revoked. Remove SETUP_PASSWORD.");
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
