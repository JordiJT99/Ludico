import { expect, it } from "vitest";
import { constructCrossword } from "./crossword-builder.js";
import { renderCrosswordSvg } from "./crossword-svg.js";

it("renders a bounded blank SVG without leaking the solution", () => {
  const candidate = constructCrossword(
    [
      word("sol", "SOL", "Astro <diurno>"),
      word("sal", "SAL", "Condimento"),
      word("luz", "LUZ", "Claridad"),
    ],
    { seed: "svg", title: 'Vista <segura> & "vacía"', vocabularyVersion: "test-v1" },
  );
  const svg = renderCrosswordSvg(candidate.publicPayload);
  expect(svg).toContain("<svg");
  expect(svg).toContain("Vista &lt;segura&gt; &amp; &quot;vacía&quot;");
  expect(svg).not.toMatch(/SOL|SAL|LUZ|correct|answer/i);
});

function word(id: string, answer: string, clue: string) {
  return { answer, clue, id, sourceUrl: `https://example.com/${id}` };
}
