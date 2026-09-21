import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
const target = "../leisson-shared";
if (!existsSync(target + "/package.json")) {
  console.error(
    "dev-link: " +
      target +
      " not found (clone leisson-shared next to this repo)",
  );
  process.exit(1);
}
// --no-save: package.json and the lockfile keep the pinned tag; `npm install` restores the pin.
const r = spawnSync(
  "npm",
  ["install", "--no-save", "--no-audit", "--no-fund", target],
  { stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(r.status ?? 1);
