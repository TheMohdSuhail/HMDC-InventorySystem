/** Messages in this class are deliberately safe to return to the browser. */
export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}
