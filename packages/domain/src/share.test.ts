import { describe, expect, it } from "vitest";
import { createShareText } from "./share.js";

describe("safe result sharing", () => {
  it("contains only the game, score and mode", () => {
    const text = createShareText("crossword", 1_250, false);
    expect(text).toBe("Lúdico · Crucigrama diario\n1250 puntos · Partida casual");
    expect(text).not.toMatch(/respuesta|solución|correcta|letra/i);
  });
});
