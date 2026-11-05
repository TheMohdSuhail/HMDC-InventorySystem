import type { OperationInput } from "./validation";
import { InventoryError } from "./errors";
export function authorizeOperation(role: string, _input: OperationInput) {
  void _input;
  if (role !== "ADMIN")
    throw new InventoryError("Admin access is required for this operation");
}
