import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const failures = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", ".svelte-kit"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      if (entry.name === "audit-subscription-only.mjs") continue;
      const text = await readFile(path, "utf8").catch(() => "");
      const rel = relative(root.pathname.slice(1), path);
      if (/["']openai["']\s*:/.test(text)) failures.push(`${rel}: direct OpenAI dependency`);
      if (/C:\\\\/.test(text)) failures.push(`${rel}: C: storage path`);
      if (/OPENAI_API_KEY\s*=/.test(text)) failures.push(`${rel}: API key assignment`);
    }
  }
}
await walk(root.pathname.slice(1));
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("subscription-only audit passed: no direct OpenAI dependency, API-key assignment, or C: storage path");
