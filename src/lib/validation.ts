import { z } from "zod";
export const quantity = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, "Use up to 3 decimal places")
  .refine((v) => Number(v) > 0, "Quantity must be positive");
export const money = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,4})?$/, "Use up to 4 decimal places");
const text = z.string().trim().max(2000).optional().default("");
const short = z.string().trim().max(191).optional().default("");
const key = z.string().uuid();
const id = z.string().min(1).max(64);
export const productSchema = z.object({
  name: z.string().trim().min(1).max(191),
  sku: short,
  barcode: short,
  category: short,
  expiryDate: z.union([z.string().date(), z.literal("")]).optional(),
  unit: z.string().trim().min(1).max(32).default("pcs"),
  purchasePrice: money,
  sellingPrice: money,
  minStock: money
    .refine((v) => /^\d+(\.\d{1,3})?$/.test(v), "Maximum 3 decimals")
    .optional(),
  notes: text,
  active: z.boolean().default(true),
});
export const manufacturerProductSchema = z.object({
  name: z.string().trim().min(1).max(191),
  sku: short,
  barcode: short,
  category: short,
});
export const supplierSchema = z.object({
  name: z.string().trim().min(1).max(191),
  contact: short,
  phone: z.string().max(64).optional().default(""),
  email: z
    .union([z.literal(""), z.string().email().max(191)])
    .optional()
    .default(""),
  address: text,
  notes: text,
  active: z.boolean().default(true),
});
const sale = z.object({
  action: z.literal("sale"),
  requestKey: key,
  customer: short,
  notes: text,
  items: z
    .array(
      z.object({
        productId: id,
        quantity,
        overridePrice: money.optional(),
        overrideReason: z.string().trim().min(5).max(2000).optional(),
        discount: money.default("0"),
      }),
    )
    .min(1)
    .max(100),
});
const purchase = z.object({
  action: z.literal("purchase"),
  requestKey: key,
  supplierId: id,
  notes: text,
  expectedAt: z.string().date().optional(),
  status: z.enum(["DRAFT", "ORDERED"]).default("ORDERED"),
  items: z
    .array(z.object({ productId: id, quantity, unitCost: money }))
    .min(1)
    .max(100),
});
const receipt = z.object({
  action: z.literal("receipt"),
  requestKey: key,
  orderId: id,
  items: z
    .array(z.object({ orderItemId: id, quantity, unitCost: money.optional() }))
    .min(1)
    .max(100),
});
const returns = z.object({
  action: z.literal("return"),
  requestKey: key,
  reason: z.string().trim().min(5).max(2000),
  notes: text,
  items: z
    .array(
      z.object({
        productId: id,
        saleItemId: id.optional(),
        quantity,
        condition: z.enum(["SELLABLE", "DAMAGED", "EXPIRED", "QUARANTINED"]),
        refund: money.optional(),
      }),
    )
    .min(1)
    .max(100),
});
const adjustment = z.object({
  action: z.literal("adjustment"),
  requestKey: key,
  productId: id,
  quantity,
  type: z.enum([
    "OPENING",
    "DAMAGED",
    "EXPIRED",
    "MISSING",
    "THEFT",
    "WRITE_OFF",
    "CORRECTION_OUT",
    "RECOVERY",
    "CORRECTION_IN",
  ]),
  reason: z.string().trim().min(5).max(2000),
  unitCost: money.optional(),
});
const cancelSale = z.object({
  action: z.literal("cancelSale"),
  requestKey: key,
  saleId: id,
  reason: z.string().trim().min(5).max(2000),
});
const orderStatus = z.object({
  action: z.literal("orderStatus"),
  requestKey: key,
  orderId: id,
  status: z.enum(["ORDERED", "CANCELLED"]),
  reason: z.string().trim().min(5).max(2000),
});
const payment = z.object({
  action: z.literal("payment"),
  requestKey: key,
  orderId: id,
  amount: money.refine((v) => Number(v) > 0),
  method: z.string().trim().min(1).max(64),
  reference: short,
});
const bucketAdjustment = z.object({
  action: z.literal("bucketAdjustment"),
  requestKey: key,
  productId: id,
  bucket: z.enum(["DAMAGED", "EXPIRED", "QUARANTINED"]),
  type: z.enum(["RELEASE", "DISPOSE"]),
  quantity,
  reason: z.string().trim().min(5).max(2000),
});
export const operationSchema = z.discriminatedUnion("action", [
  sale,
  purchase,
  receipt,
  returns,
  adjustment,
  cancelSale,
  orderStatus,
  payment,
  bucketAdjustment,
]);
export type OperationInput = z.infer<typeof operationSchema>;
export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(191),
  minStock: money.refine((v) => /^\d+(\.\d{1,3})?$/.test(v)),
  dateFormat: z.enum(["dd/MM/yyyy", "yyyy-MM-dd"]),
});
