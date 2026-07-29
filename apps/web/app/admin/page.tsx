import type { Metadata } from "next";
import { AdminDashboard } from "./admin-dashboard";

export const metadata: Metadata = { robots: { index: false, follow: false }, title: "Backoffice" };

export default function AdminPage() {
  return (
    <main>
      <p className="eyebrow">Operación</p>
      <h1>Backoffice de contenido</h1>
      <AdminDashboard />
    </main>
  );
}
