import type { PublicEdition, PublicGame } from "@ludico/contracts";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export default async function GameShortcutPage({
  params,
}: Readonly<{ params: Promise<{ type: string }> }>) {
  const type = ({ quiz: "quiz", crucigrama: "crossword" } as const)[
    (await params).type as "quiz" | "crucigrama"
  ];
  if (!type) notFound();
  const game = await loadActiveGame(type);
  if (game) redirect(`/jugar/${game.id}`);
  return (
    <main>
      <h1>Este reto no está disponible ahora mismo</h1>
      <p>La edición puede estar preparándose o el juego puede haberse desactivado temporalmente.</p>
      <Link className="button-link" href="/">
        Ver los retos de hoy
      </Link>
    </main>
  );
}

async function loadActiveGame(type: PublicGame["type"]): Promise<PublicGame | null> {
  try {
    const apiUrl = process.env.PUBLIC_API_URL ?? "http://localhost:4000/v1";
    const response = await fetch(`${apiUrl}/editions/today`, { cache: "no-store" });
    if (!response.ok) return null;
    const edition = (await response.json()) as PublicEdition;
    return edition.games.find((game) => game.type === type && game.status === "active") ?? null;
  } catch {
    return null;
  }
}
