import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Absolute path of a file inside @leisson/shared, e.g. sharedFile('orbit-tokens/dist/orbit.css').
export const sharedFile = (rel) => require.resolve("@leisson/shared/" + rel);
