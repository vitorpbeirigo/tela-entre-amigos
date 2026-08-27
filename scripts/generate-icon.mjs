import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const assetsDirectory = path.join(projectRoot, "assets");
const sourcePath = path.join(assetsDirectory, "brand", "infinity-app-icon.png");
const pngPath = path.join(assetsDirectory, "icon.png");
const icoPath = path.join(assetsDirectory, "icon.ico");

await mkdir(assetsDirectory, { recursive: true });
await sharp(sourcePath).resize(1024, 1024, { fit: "contain" }).png().toFile(pngPath);
const ico = await pngToIco(pngPath);
await writeFile(icoPath, ico);

console.log(`Icones gerados em ${assetsDirectory}`);
