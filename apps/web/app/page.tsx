import { isPublicEdition, isPublicQuizGame, type PublicEdition } from "@ludico/contracts";
import Link from "next/link";
import { AnalyticsEvent } from "./analytics-event";
import { GuestSessionBootstrap } from "./guest-session-bootstrap";
import { PreviousResultsPanel } from "./previous-results-panel";
import { SiteHeader } from "./site-header";

export const dynamic = "force-dynamic";

export default async function Home() {
  const edition = await loadEdition();
  const previous = edition ? await loadEditionPath(previousDate(edition.localDate)) : null;

  return (
    <>
      <SiteHeader />
      <main className="dashboard">
        <section className="dashboard-hero">
          <p className="eyebrow">La edición de hoy</p>
          {edition ? <p className="dashboard-date">{formatDate(edition.localDate)}</p> : null}
          <h1>Un rato para pensar, cada día.</h1>
          <p className="hero-quote">
            “La curiosidad es la forma más elegante de entrenar la mente.”
          </p>
        </section>
        <GuestSessionBootstrap />
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
            <section aria-labelledby="today-heading" className="today-games">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Retos del día</p>
                  <h2 id="today-heading">Elige por dónde empezar</h2>
                </div>
                <span>
                  {edition.games.filter((game) => game.status === "active").length} disponibles
                </span>
              </div>
              <div className="games games--featured">
                {edition.games.map((game) => (
                  <article className={`game game--${game.type}`} key={game.id}>
                    <div aria-hidden="true" className="game__art">
                      {game.type === "quiz" ? "?" : game.type === "true_false" ? "V/F" : "✦"}
                    </div>
                    <div className="game__content">
                      <p className="game__kicker">
                        {game.type === "quiz"
                          ? "Saber y pensar"
                          : game.type === "true_false"
                            ? "Ciencia y curiosidades"
                            : game.type === "guess_word"
                              ? "Léxico y deducción"
                              : game.type === "word_search"
                                ? "Atención y vocabulario"
                                : "Palabras cruzadas"}
                      </p>
                      <h3>
                        {game.type === "quiz"
                          ? "Quiz diario"
                          : game.type === "true_false"
                            ? "Verdadero o falso"
                            : game.type === "guess_word"
                              ? "Adivina la palabra"
                              : game.type === "word_search"
                                ? "Sopa de letras"
                                : "Crucigrama diario"}
                      </h3>
                      <p>
                        {game.status === "active"
                          ? game.type === "quiz"
                            ? isPublicQuizGame(game)
                              ? `${game.payload.questions.length} ${game.payload.questions.length === 1 ? "pregunta" : "preguntas"} para despertar la curiosidad.`
                              : "Preguntas para despertar la curiosidad."
                            : game.type === "true_false"
                              ? "Decide qué afirmaciones son correctas."
                              : game.type === "guess_word"
                                ? "Una definición, pistas y una sola palabra."
                                : game.type === "word_search"
                                  ? "Encuentra las palabras escondidas en la cuadrícula."
                                  : "Una cuadrícula para tomarse el tiempo necesario."
                          : "Temporalmente no disponible"}
                      </p>
                      {game.status === "active" ? (
                        <Link className="button-link" href={`/jugar/${game.id}`}>
                          Jugar <span aria-hidden="true">→</span>
                        </Link>
                      ) : (
                        <button disabled type="button">
                          Próximamente
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className="empty-state">
            <p role="status">La edición de hoy se está preparando. Vuelve en unos minutos.</p>
          </section>
        )}
        <PreviousResultsPanel />
        {previous ? (
          <section aria-labelledby="previous-heading" className="previous-edition">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Archivo diario</p>
                <h2 id="previous-heading">Soluciones de ayer</h2>
              </div>
            </div>
            <div className="games">
              {previous.games.map((game) => (
                <article className="game" key={game.id}>
                  <h3>
                    {game.type === "quiz"
                      ? "Quiz de ayer"
                      : game.type === "true_false"
                        ? "Verdadero o falso de ayer"
                        : game.type === "guess_word"
                          ? "Adivina la palabra de ayer"
                          : "Crucigrama de ayer"}
                  </h3>
                  <Link className="button-link" href={`/resultados/${game.id}`}>
                    Ver solución
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        <Link className="archive-link" href="/archivo">
          Ver el archivo de los últimos siete días <span aria-hidden="true">→</span>
        </Link>
      </main>
    </>
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
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeZone: "UTC" }).format(
    new Date(`${localDate}T12:00:00Z`),
  );
}
