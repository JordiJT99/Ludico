import { isPublicEdition, type PublicEdition } from "@ludico/contracts";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  alternates: { canonical: "/archivo" },
  description: "Consulta las soluciones publicadas de los retos recientes de Lúdico.",
  title: "Archivo de retos",
};

export default async function ArchivePage() {
  const editions = await loadRecentEditions();
  return (
    <main>
      <p className="eyebrow">Siete días</p>
      <h1>Archivo de retos</h1>
      <p>Las soluciones aparecen sólo después del cierre oficial de cada edición.</p>
      {editions.length ? (
        <ol className="archive-list">
          {editions.map((edition) => (
            <li key={edition.id}>
              <Link href={`/ediciones/${edition.localDate}`}>{formatDate(edition.localDate)}</Link>
              <span>{edition.games.length} retos</span>
            </li>
          ))}
        </ol>
      ) : (
        <p role="status">Todavía no hay ediciones anteriores disponibles.</p>
      )}
      <Link className="button-link" href="/">
        Volver a hoy
      </Link>
    </main>
  );
}

async function loadRecentEditions(): Promise<PublicEdition[]> {
  const dates = recentDates(new Date(), 7);
  const values = await Promise.all(dates.map(loadEdition));
  return values.filter((value): value is PublicEdition => value !== null);
}

async function loadEdition(localDate: string): Promise<PublicEdition | null> {
  try {
    const apiUrl = process.env.PUBLIC_API_URL ?? "http://localhost:4000/v1";
    const response = await fetch(`${apiUrl}/editions/${localDate}`, { cache: "no-store" });
    const body: unknown = response.ok ? await response.json() : null;
    return isPublicEdition(body) ? body : null;
  } catch {
    return null;
  }
}

function recentDates(now: Date, days: number): string[] {
  const today = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).format(now);
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  return Array.from({ length: days }, (_, offset) =>
    new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0, 10),
  );
}

function formatDate(localDate: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${localDate}T12:00:00Z`),
  );
}
