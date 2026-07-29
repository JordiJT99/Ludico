import { isCrosswordPublicPayload, type CrosswordPublicPayload } from "@ludico/contracts";
import { InvalidCrosswordError } from "./crossword.js";

const cellSize = 40;

export function renderCrosswordSvg(value: unknown): string {
  if (!isCrosswordPublicPayload(value) || value.rows > 21 || value.columns > 21) {
    throw new InvalidCrosswordError("No se puede previsualizar una cuadrícula inválida");
  }
  const crossword: CrosswordPublicPayload = value;
  const open = new Map(crossword.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
  const shapes: string[] = [];
  for (let row = 0; row < crossword.rows; row += 1) {
    for (let column = 0; column < crossword.columns; column += 1) {
      const cell = open.get(`${row}:${column}`);
      const x = column * cellSize;
      const y = row * cellSize;
      shapes.push(
        `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${cell ? "#fff9ef" : "#17233c"}" stroke="#17233c"/>`,
      );
      if (cell?.number) {
        shapes.push(
          `<text x="${x + 4}" y="${y + 12}" font-family="system-ui,sans-serif" font-size="10" fill="#17233c">${cell.number}</text>`,
        );
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title" viewBox="0 0 ${crossword.columns * cellSize} ${crossword.rows * cellSize}"><title id="title">${escapeXml(crossword.title)}</title>${shapes.join("")}</svg>`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '"': "&quot;",
      "&": "&amp;",
      "'": "&apos;",
      "<": "&lt;",
      ">": "&gt;",
    };
    return entities[character]!;
  });
}
