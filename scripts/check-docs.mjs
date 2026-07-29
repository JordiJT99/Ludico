import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve("docs");
const files = walk(root).filter((file) => file.endsWith(".md"));
const missing = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\[[^\]]+]\(([^)]+)\)/g)) {
    const target = match[1]?.split("#", 1)[0];
    if (target && !/^(https?:|mailto:|[A-Za-z]:)/.test(target)) {
      const path = resolve(dirname(file), target);
      if (!existsSync(path)) missing.push(`${file}: ${target}`);
    }
  }
}

const required = [
  "FR-001",
  "FR-016",
  "NFR-001",
  "NFR-012",
  "SEC-001",
  "SEC-015",
  "US-001",
  "US-034",
  "T-UNIT-001",
  "T-DR-001",
  "LAUNCH-01",
  "LAUNCH-20",
];
const corpus = files.map((file) => readFileSync(file, "utf8")).join("\n");
const absent = required.filter((id) => !corpus.includes(id));

if (missing.length || absent.length) {
  console.error([...missing, ...absent.map((id) => `Falta ${id}`)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentación válida: ${files.length} archivos, enlaces e IDs correctos.`);
}

function walk(path) {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? walk(child) : child;
  });
}
