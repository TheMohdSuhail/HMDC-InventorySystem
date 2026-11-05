import { excelFile } from "../src/lib/excel";
import { readSheet } from "read-excel-file/node";
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.startsWith("/inventory_validation_"))
  throw new Error("Dedicated test database required");
const db = new PrismaClient({ datasourceUrl: url });
const suffix = Date.now();
const password = randomBytes(24).toString("hex");
const passwordHash = await hash(password, 12);
const users = await Promise.all(
  ["ADMIN", "BRANCH_MANAGER", "MANUFACTURER"].map((role) =>
    db.user.create({
      data: {
        email: `${role.toLowerCase()}-${suffix}@example.invalid`,
        role,
        passwordHash,
      },
    }),
  ),
);
const [admin, branch, manufacturer] = users;
await db.loginAttempt.updateMany({
  data: { count: 0, resetAt: new Date(Date.now() + 900000) },
});
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-p", "3100"],
  {
    env: {
      ...process.env,
      DATABASE_URL: url,
      APP_URL: "http://localhost:3100",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
let logs = "";
child.stdout.on("data", (c) => (logs += String(c)));
child.stderr.on("data", (c) => (logs += String(c)));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(60000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = "http://localhost:3100";
async function login(email: string) {
  await page.goto(base + "/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByText(/^(Inventory|Production) connected$/)
    .waitFor({ state: "attached" });
}
async function downloadExcel(path: string) {
  const r = await page.request.get(base + path);
  assert.equal(r.status(), 200);
  assert.ok(r.headers()["content-type"].includes("spreadsheetml"));
  assert.ok(r.headers()["content-disposition"].includes(".xlsx"));
  return readSheet(Buffer.from(await r.body()), 1);
}
async function logout() {
  await page
    .locator(".topbar")
    .getByRole("button", { name: "Log out", exact: true })
    .click();
  await page.waitForURL("**/login");
  assert.equal((await page.request.get(base + "/api/data")).status(), 401);
}
const nav = () => page.getByRole("navigation");
async function batch(name: string, code: string, qty: string, source?: string) {
  await page.getByRole("button", { name, exact: true }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Reason / notes").fill("Browser validation batch");
  if (source) await d.getByLabel(source).selectOption({ index: 1 });
  await d.getByLabel("Scan operation barcode").fill(code);
  await d.getByLabel("Scan operation barcode").press("Enter");
  await d.getByLabel("Quantity row 1").fill(qty);
  return d;
}
async function save() {
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Review entries", exact: true }).click();
  await d.getByRole("button", { name: /^(Confirm stock addition|Confirm stock transfer to branch|Save sale|Save customer return|Save finished stock|Confirm stock sent to warehouse|Confirm receipt from manufacturer)$/, exact: true }).click();
  await d.waitFor({ state: "hidden" });
}
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/login")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal((await page.request.get(base + "/api/data")).status(), 401);
  await login(admin.email);
  for (const name of [
    "Inventory",
    "Branches",
    "Production",
    "Stock activity",
    "Purchases",
    "Suppliers",
    "Reports",
    "Settings",
  ]) {
    await nav().getByRole("button", { name, exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).first().waitFor();
  }
  await nav().getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Enter new product details", exact: true }).click();
  let d = page.getByRole("dialog");
  const name = `Quantity browser ${suffix}`,
    code = `00Q${suffix}`;
  await d.getByLabel("Product name", { exact: true }).fill(name);
  await d.getByLabel("Product barcode").fill(code);
  await d.getByLabel("Expiry date", { exact: true }).fill("2027-12-31");
  await d.getByRole("button", { name: "Create product", exact: true }).click();
  await d.waitFor({ state: "hidden" });
  let data = await (await page.request.get(base + "/api/data")).json();
  const product = data.products.find((p: { name: string }) => p.name === name);
  assert.ok(product);
  assert.ok(product.expiryDate.startsWith("2027-12-31"));
  assert.equal("purchasePrice" in product, false);
  await downloadExcel("/api/export?type=products");
  await downloadExcel("/api/export?type=operations");
  await downloadExcel("/api/reports?format=xlsx");
  await batch("Add stock to warehouse", code, "10");
  await save();
  await nav().getByRole("button", { name: "Branches", exact: true }).click();
  await page.getByRole("button", { name: "Send stock to branch" }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Inventory location").selectOption(branch.id);
  await d.getByLabel("Reason / notes").fill("Assign to test branch");
  await d.getByLabel("Scan operation barcode").fill(code);
  await d.getByLabel("Scan operation barcode").press("Enter");
  await d.getByLabel("Quantity row 1").fill("4");
  await save();
  await nav().getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Import new products from Excel" }).click();
  d = page.getByRole("dialog");
  const template = await page.request.get(base + "/api/products/bulk");
  assert.ok(template.headers()["content-type"].includes("spreadsheetml"));
  const templateRows = await readSheet(Buffer.from(await template.body()), 1);
  assert.ok(!templateRows[0].includes("purchasePrice"));
  await d.locator("input[type=file]").setInputFiles({
    name: "products.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(
      excelFile([
        {
          name: `Excel ${suffix}`,
          barcode: `00EXCEL${suffix}`,
          openingQuantity: "3",
          expiryDate: "2028-01-31",
        },
      ]),
    ),
  });
  await d.getByRole("button", { name: /Create products and save opening stock/ }).click();
  await d.waitFor({ state: "hidden" });
  await nav().getByRole("button", { name: "Dashboard", exact: true }).click();
  mkdirSync("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/quantity-admin-desktop.png",
    fullPage: true,
  });
  assert.ok(!(await page.locator("body").innerText()).includes("?"));
  await logout();
  await login(branch.email);
  data = await (await page.request.get(base + "/api/data")).json();
  assert.equal(data.products.length, 1);
  assert.equal(data.products[0].stock, "4");
  const branchExport = await downloadExcel("/api/export?type=products");
  assert.equal(branchExport.length, 2);
  assert.ok(branchExport[1].includes(code));
  assert.equal(data.users.length, 0);
  assert.ok(!JSON.stringify(data).includes("purchasePrice"));
  assert.equal(
    (await page.request.get(base + "/api/export?type=suppliers")).status(),
    403,
  );
  assert.equal(
    (
      await page.request.post(base + "/api/data", {
        headers: { origin: base },
        data: { action: "product", data: { name: "Forbidden" } },
      })
    ).status(),
    403,
  );
  assert.equal(
    (
      await page.request.post(base + "/api/quantity", {
        headers: { origin: base },
        data: {
          requestKey: randomUUID(),
          type: "ASSIGN",
          ownerId: branch.id,
          notes: "Forbidden assignment",
          items: [{ productId: product.id, quantity: "1" }],
        },
      })
    ).status(),
    403,
  );
  await batch("Record sale", code, "2");
  await save();
  await batch("Record customer return", code, "1", "Original sale");
  await save();
  data = await (await page.request.get(base + "/api/data")).json();
  assert.equal(data.products[0].stock, "3");
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileNavBox = await nav().boundingBox();
  assert.ok(
    mobileNavBox && mobileNavBox.x >= 0,
    "Mobile navigation must stay on screen",
  );
  await nav().getByRole("button", { name: "Stock activity", exact: true }).click();
  await page
    .getByRole("heading", { name: "Stock activity", exact: true })
    .waitFor();
  await nav().getByRole("button", { name: "Dashboard", exact: true }).click();
  await page.screenshot({
    path: "artifacts/quantity-branch-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await logout();
  await login(manufacturer.email);
  assert.equal(
    await page.getByRole("button", { name: "Inventory", exact: true }).count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("heading", { name: "Production", exact: true })
      .count(),
    1,
  );
  const manufacturerProductName = `Manufacturer product ${suffix}`,
    manufacturerProductCode = `M${suffix}`;
  await page
    .getByRole("button", { name: "Record finished stock", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Enter new product details", exact: true }).click();
  await d
    .getByLabel("Product name", { exact: true })
    .fill(manufacturerProductName);
  await d
    .getByLabel("Barcode (optional)", { exact: true })
    .fill(manufacturerProductCode);
  await d.getByRole("button", { name: "Create product and add to list", exact: true }).click();
  data = await (await page.request.get(base + "/api/data")).json();
  const manufacturerProduct = data.products.find(
    (p: { name: string }) => p.name === manufacturerProductName,
  );
  assert.ok(manufacturerProduct);
  assert.equal(manufacturerProduct.unit, "pcs");
  assert.equal("stock" in manufacturerProduct, false);
  await d.getByLabel("Reason / notes").fill("New manufacturer product ready");
  await d.getByLabel("loosePieces row 1").fill("6");
  await d.getByLabel("Scan operation barcode").fill(code);
  await d.getByLabel("Scan operation barcode").press("Enter");
  await d.getByLabel("boxes row 2").fill("2");
  await d.getByLabel("piecesPerBox row 2").fill("12");
  await d.getByLabel("loosePieces row 2").fill("3");
  await save();
  await page
    .getByRole("button", { name: "Send stock to warehouse", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.getByLabel("Reason / notes").fill("Dispatch production batch");
  await d.getByLabel("Scan operation barcode").fill(code);
  await d.getByLabel("Scan operation barcode").press("Enter");
  await d.getByLabel("loosePieces row 1").fill("15");
  await save();
  data = await (await page.request.get(base + "/api/data")).json();
  assert.equal(
    "stock" in data.products.find((p: { id: string }) => p.id === product.id),
    false,
  );
  assert.deepEqual(data.balances, []);
  assert.deepEqual(data.events, []);
  await logout();
  await login(admin.email);
  data = await (await page.request.get(base + "/api/data")).json();
  assert.equal(
    data.events.find((e: { type: string }) => e.type === "DISPATCH").items[0]
      .processed,
    "0",
  );
  const dispatchId = data.events.find(
    (e: { type: string }) => e.type === "DISPATCH",
  ).id;
  await page
    .getByRole("button", { name: "Receive stock from manufacturer", exact: true })
    .click();
  d = page.getByRole("dialog");
  const dispatchOptions = await d
    .getByLabel("Original dispatch")
    .locator("option")
    .allTextContents();
  assert.ok(dispatchOptions.some((option) => option.includes(name)));
  await d.getByLabel("Original dispatch").selectOption(dispatchId);
  await d.getByLabel("Reason / notes").fill("Received factory delivery");
  await d.getByLabel("Scan operation barcode").fill(code);
  await d.getByLabel("Scan operation barcode").press("Enter");
  await d.getByLabel("Quantity row 1").fill("15");
  await save();
  data = await (await page.request.get(base + "/api/data")).json();
  assert.equal(
    data.products.find((p: { id: string }) => p.id === product.id).stock,
    "21",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Chrome passed: quantity-only screens, expiry, Excel import, barcode batches, branch isolation/sale/return, manufacturer boxes/dispatch, admin receipt, mobile layout.",
  );
} catch (e) {
  await page
    .screenshot({
      path: "artifacts/quantity-browser-failure.png",
      fullPage: true,
    })
    .catch(() => {});
  console.error(logs.replace(/mysql:\/\/[^\s]+/g, "mysql://[redacted]"));
  throw e;
} finally {
  await browser.close();
  child.kill();
  await db.$disconnect();
}
