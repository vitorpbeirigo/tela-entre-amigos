import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const assetsDirectory = path.join(projectRoot, "assets");
const svgPath = path.join(assetsDirectory, "icon.svg");
const pngPath = path.join(assetsDirectory, "icon.png");
const icoPath = path.join(assetsDirectory, "icon.ico");

await mkdir(assetsDirectory, { recursive: true });
const svg = await readFile(svgPath);
await sharp(svg).resize(1024, 1024).png().toFile(pngPath);
const ico = await pngToIco(pngPath);
await writeFile(icoPath, ico);

console.log(`Icones gerados em ${assetsDirectory}`);
