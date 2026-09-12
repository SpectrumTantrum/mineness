import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const downloads = [
  ["mc-server/paper.jar", "https://fill-data.papermc.io/v1/objects/5ffef465eeeb5f2a3c23a24419d97c51afd7dbb4923ff42df9a3f58bba1ccfba/paper-1.21.11-132.jar", "5ffef465eeeb5f2a3c23a24419d97c51afd7dbb4923ff42df9a3f58bba1ccfba"],
  ["mc-server/plugins/SkinsRestorer.jar", "https://github.com/SkinsRestorer/SkinsRestorer/releases/download/15.12.5/SkinsRestorer.jar", "bf13ffee9bb488141b7ec99603ebc8abac689933d72db15e664feb0b4deefc60"],
];
for (const [relative, url, sha] of downloads) {
  const path = join(root, relative);
  if (existsSync(path)) { console.log(`Keeping existing ${relative}`); continue; }
  console.log(`Downloading ${relative}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== sha) throw new Error(`Checksum mismatch for ${relative}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path + ".download", data);
  await rename(path + ".download", path);
}
const properties = join(root, "mc-server/server.properties");
if (!existsSync(properties)) {
  const template = await readFile(join(root, "mc-server/server.properties.example"), "utf8");
  await writeFile(properties, template.replace("GENERATE_PASSWORD", randomBytes(24).toString("hex")), { mode: 0o600 });
}
if (!existsSync(join(root, "mc-server/eula.txt"))) {
  await writeFile(join(root, "mc-server/eula.txt"), "# Review https://aka.ms/MinecraftEULA before changing this.\neula=false\n");
  console.log("Set eula=true in mc-server/eula.txt after accepting the Minecraft EULA.");
}
await cp(join(root, "mc-server/datapacks/mineness"), join(root, "mc-server/world/datapacks/mineness"), { recursive: true });
console.log("Server files ready. Start with npm run server.");
