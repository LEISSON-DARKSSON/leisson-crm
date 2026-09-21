#!/usr/bin/env node
// Fails when a consumer's pinned @leisson/shared tag is more than one minor behind the latest tag.
// Usage (from a consumer repo):  node node_modules/@leisson/shared/tools/check-pin.mjs
// Needs GH_TOKEN (read access to leisson-shared) in the environment.
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const spec =
  { ...pkg.dependencies, ...pkg.devDependencies }["@leisson/shared"] ?? "";
const pinned = /#v(\d+)\.(\d+)\.(\d+)$/.exec(spec);
if (!pinned) {
  console.error(
    "check-pin: @leisson/shared is not pinned to a vX.Y.Z tag: " + spec,
  );
  process.exit(1);
}
const res = await fetch(
  "https://api.github.com/repos/LEISSON-DARKSSON/leisson-shared/tags?per_page=100",
  {
    headers: {
      authorization: "Bearer " + process.env.GH_TOKEN,
      accept: "application/vnd.github+json",
    },
  },
);
if (!res.ok) {
  console.error("check-pin: GitHub API " + res.status);
  process.exit(1);
}
const tags = (await res.json())
  .map((t) => /^v(\d+)\.(\d+)\.(\d+)$/.exec(t.name))
  .filter(Boolean)
  .map((m) => m.slice(1).map(Number))
  .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
const latest = tags.at(-1);
const [pMaj, pMin] = pinned.slice(1).map(Number);
const behind = (latest[0] - pMaj) * 1000 + (latest[1] - pMin);
if (behind > 1) {
  console.error(
    `check-pin: pinned v${pinned.slice(1).join(".")} is behind latest v${latest.join(".")}`,
  );
  process.exit(1);
}
console.log(
  `check-pin: ok (pinned v${pinned.slice(1).join(".")}, latest v${latest.join(".")})`,
);
