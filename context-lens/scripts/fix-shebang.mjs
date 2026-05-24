import { chmod, readFile, writeFile } from "node:fs/promises";

const path = new URL("../dist/cli.js", import.meta.url);
const text = await readFile(path, "utf8");
const shebang = "#!/usr/bin/env node\n";
if (!text.startsWith(shebang)) {
  await writeFile(path, shebang + text.replace(/^#!.*\n/, ""));
}
await chmod(path, 0o755);
