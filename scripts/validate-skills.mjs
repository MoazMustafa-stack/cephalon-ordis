import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../plugins/cephalon-ordis/skills", import.meta.url));
const validator = process.env.ORDIS_SKILL_VALIDATOR;
if (!validator) {
  console.error("Set ORDIS_SKILL_VALIDATOR to the skill-creator scripts/quick_validate.py path.");
  process.exit(2);
}
for (const name of readdirSync(root)) {
  const result = spawnSync("python", [validator, join(root, name)], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

