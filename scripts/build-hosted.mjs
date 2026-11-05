import { mkdirSync, writeFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
if (!process.env.AIVEN_CA_BASE64)
  throw new Error(
    "Set AIVEN_CA_BASE64 in protected build environment settings",
  );
const certificate = Buffer.from(process.env.AIVEN_CA_BASE64, "base64");
new X509Certificate(certificate);
mkdirSync("prisma/certs", { recursive: true });
writeFileSync("prisma/certs/aiven-ca.pem", certificate);
for (const args of [
  ["node_modules/prisma/build/index.js", "generate"],
  ["node_modules/next/dist/bin/next", "build"],
]) {
  const r = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}
