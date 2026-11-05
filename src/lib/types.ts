import type {
  Prisma,
  Product,
  Supplier,
  Settings,
  AuditLog,
} from "@prisma/client";
type Json<T> = T extends Date
  ? string
  : T extends Prisma.Decimal
    ? string
    : T extends object
      ? { [K in keyof T]: Json<T[K]> }
      : T;
export type ProductData = Json<Product>;
export type SupplierData = Json<Supplier>;
export type SaleData = Json<
  Prisma.SaleGetPayload<{ include: { items: { include: { product: true } } } }>
>;
export type ReturnData = Json<
  Prisma.SalesReturnGetPayload<{
    include: {
      items: {
        include: { product: true; saleItem: { include: { sale: true } } };
      };
    };
  }>
>;
export type PurchaseData = Json<
  Prisma.PurchaseOrderGetPayload<{
    include: {
      supplier: true;
      items: { include: { product: true } };
      receipts: { include: { items: true } };
      payments: true;
    };
  }>
>;
export type MovementData = Json<
  Prisma.StockMovementGetPayload<{ include: { product: true } }>
>;
export type Data = {
  user: { id: string; email: string; role: string };
  products: ProductData[];
  suppliers: SupplierData[];
  sales: SaleData[];
  returns: ReturnData[];
  purchases: PurchaseData[];
  movements: MovementData[];
  settings: Json<Settings>;
  audit: Json<AuditLog>[];
};
export type ReportData = Awaited<
  ReturnType<typeof import("./reports").reports>
>;
