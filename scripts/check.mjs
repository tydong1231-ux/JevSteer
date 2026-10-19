import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["bin", "src", "scripts", "test", "e2e"];
const files = [];
async function collect(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) await collect(join(root, entry.name));
    else if (entry.name.endsWith(".mjs")) files.push(join(root, entry.name));
  }
}
for (const root of roots) {
  await collect(root).catch((e) => { if (e.code !== 'ENOENT') throw e; });
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
