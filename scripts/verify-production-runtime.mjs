import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const command =
  "await Promise.all([import('@ludico/contracts'), import('@ludico/domain'), import('@ludico/database')]);";

for (const workspace of ["apps/api", "apps/worker"]) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", command], {
    cwd: resolve(root, workspace),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      `Los artefactos de producci\u00f3n no cargan desde ${workspace}:\n${result.stderr}`,
    );
  }
}

console.log("Los artefactos de producci\u00f3n cargan en API y worker.");
