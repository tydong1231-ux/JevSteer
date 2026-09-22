import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["bin", "src", "scripts", "test"];
const files = [];
for (const root of roots) {
  for (const name of await readdir(root)) if (name.endsWith(".mjs")) files.push(join(root, name));
}
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr);
  }
}
if (failed) process.exit(1);
console.log(`Syntax OK: ${files.length} files`);
