import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { sharedFile } from "../lib/shared-path.mjs";
for (const rel of [
  "orbit-tokens/dist/orbit.css",
  "orbit-tokens/orbit.tokens.json",
  "service-catalog/catalog.json",
]) {
  assert.ok(
    existsSync(sharedFile(rel)),
    rel + " must resolve inside @leisson/shared",
  );
}
console.log("shared-path: ok");
