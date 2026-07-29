import { isPublicEdition, type PublicEdition } from "@ludico/contracts";
import Link from "next/link";
import { AnalyticsEvent } from "./analytics-event";
import { GuestSessionBootstrap } from "./guest-session-bootstrap";
import { PreviousResultsPanel } from "./previous-results-panel";

export const dynamic = "force-dynamic";

export default async function Home() {
  const edition = await loadEdition();
  const previous = edition ? await loadEditionPath(previousDate(edition.localDate)) : null;

  return (
    <main>
      <p className="eyebrow">Lúdico</p>
      <h1>Un rato para pensar, cada día.</h1>
      <GuestSessionBootstrap />
      <PreviousResultsPanel />
      {edition ? (
        <>
          <AnalyticsEvent
            name="DailyEditionViewed"
            properties={{
              availability: "available",
              editionId: edition.id,
              localDate: edition.localDate,
              platform: "web",
            }}
          />
          <section aria-labelledby="today-heading">
            <h2 id="today-heading">Retos del {formatDate(edition.localDate)}</h2>
            <div className="games">
              {edition.games.map((game) => (
                <article className="game" key={game.id}>
                  <h3>{game.type === "quiz" ? "Quiz diario" : "Crucigrama diario"}</h3>
                  <p>
                    {game.status === "active" ? "Listo para jugar" : "Temporalmente no disponible"}
                  </p>
                  {game.status === "active" ? (
                    <Link className="button-link" href={`/jugar/${game.id}`}>
                      Jugar
                    </Link>
                  ) : (
                    <button disabled type="button">
                      Próximamente
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <p role="status">La edición de hoy se está preparando. Vuelve en unos minutos.</p>
      )}
      {previous ? (
        <section aria-labelledby="previous-heading">
          <h2 id="previous-heading">Soluciones de ayer</h2>
          <div className="games">
            {previous.games.map((game) => (
              <article className="game" key={game.id}>
                <h3>{game.type === "quiz" ? "Quiz de ayer" : "Crucigrama de ayer"}</h3>
                <Link className="button-link" href={`/resultados/${game.id}`}>
                  Ver solución
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <p>
        <Link href="/archivo">Ver el archivo de los últimos siete días</Link>
      </p>
    </main>
  );
}

async function loadEdition(): Promise<PublicEdition | null> {
  return loadEditionPath("today");
}

async function loadEditionPath(path: string): Promise<PublicEdition | null> {
  const apiUrl = process.env.PUBLIC_API_URL ?? "http://localhost:4000/v1";
  try {
    const response = await fetch(`${apiUrl}/editions/${path}`, { cache: "no-store" });
    const body: unknown = response.ok ? await response.json() : null;
    return isPublicEdition(body) ? body : null;
  } catch {
    return null;
  }
}

function previousDate(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function formatDate(localDate: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${localDate}T12:00:00Z`),
  );
}
