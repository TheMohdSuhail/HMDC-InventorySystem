import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import InventoryApp from "@/components/quantity-app";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!(await currentUser())) redirect("/login");
  return <InventoryApp />;
}
