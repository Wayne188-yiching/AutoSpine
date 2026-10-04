// Synthetic test artwork only: no user PNGs or artist skeleton answers.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import process from "node:process";
import console from "node:console";

const destination = process.argv[2];
if (!destination || process.argv.length !== 3)
  throw new Error("Usage: node fixtures/chain-wave/create-demo.mjs <new-directory>");
const directory = resolve(destination);
await mkdir(directory); // Existing output is intentionally rejected.
const png = new PNG({ width: 160, height: 80 });
for (let y = 0; y < 80; y++)
  for (let x = 0; x < 160; x++) {
    const body = ((x - 58) / 45) ** 2 + ((y - 40) / 22) ** 2 <= 1;
    const tail = x >= 88 && x <= 145 && Math.abs(y - 40) <= (x - 88) * 0.48 + 3;
    const fin = x >= 42 && x <= 72 && y >= 15 - Math.min(x - 42, 72 - x) * 0.6 && y <= 26;
    if (!body && !tail && !fin) continue;
    const index = (y * 160 + x) * 4,
      eye = (x - 32) ** 2 + (y - 34) ** 2 <= 5;
    png.data[index] = eye ? 12 : 30;
    png.data[index + 1] = eye ? 20 : 150;
    png.data[index + 2] = eye ? 30 : 205;
    png.data[index + 3] = 255;
  }
await writeFile(resolve(directory, "fish.png"), PNG.sync.write(png), { flag: "wx" });
const job = {
  schemaVersion: "0.1",
  kind: "build-job",
  id: "synthetic-fish",
  name: "Synthetic fish",
  profile: "chain-wave",
  source: "fish.png",
  output: "build",
  cleanupFraction: 0.005,
  chain: { start: [25, 40], end: [140, 40], boneCount: 5 },
  wave: { duration: 2, fps: 24, amplitudeDegrees: 8, phaseDegrees: 45 },
};
await writeFile(resolve(directory, "job.json"), JSON.stringify(job, null, 2) + "\n", {
  flag: "wx",
});
console.log(resolve(directory, "job.json"));
