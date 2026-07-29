import { isPublicEdition, type PublicEdition } from "@ludico/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = Readonly<{ params: Promise<{ date: string }> }>;
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { date } = await params;
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? { alternates: { canonical: `/ediciones/${date}` }, title: `Edición ${date}` }
    : { robots: { follow: false, index: false }, title: "Edición no disponible" };
}

export default async function EditionPage({ params }: PageProps) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const edition = await loadEdition(date);
  if (!edition) notFound();
  const closed = Date.parse(edition.closesAt) <= Date.now();
  return (
    <main>
      <p className="eyebrow">Archivo diario</p>
      <h1>Retos del {formatDate(edition.localDate)}</h1>
      <div className="games">
        {edition.games.map((game) => (
          <article className="game" key={game.id}>
            <h2>{game.type === "quiz" ? "Quiz diario" : "Crucigrama diario"}</h2>
            {closed ? (
              <Link className="button-link" href={`/resultados/${game.id}`}>
                Ver solución
              </Link>
            ) : game.status === "active" ? (
              <Link className="button-link" href={`/jugar/${game.id}`}>
                Jugar
              </Link>
            ) : (
              <p>Temporalmente no disponible.</p>
            )}
          </article>
        ))}
      </div>
      <Link href="/archivo">Volver al archivo</Link>
    </main>
  );
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

function formatDate(localDate: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${localDate}T12:00:00Z`),
  );
}
