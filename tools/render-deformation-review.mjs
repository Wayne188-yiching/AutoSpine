// Original geometric fixtures, not artist-reference coordinates.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateChainRig, evaluateRig, transformPoint } from "@autospine/rig";
import {
  solveWeightsV1,
  skinVertices,
  measureDeformation,
  deformationPasses,
} from "@autospine/weights";
import { generateWave, rotationsAt } from "@autospine/motion";
import process from "node:process";
import console from "node:console";
const [gate, destination] = process.argv.slice(2);
if (!["6", "7"].includes(gate) || !destination)
  throw new Error("Usage: render-deformation-review.mjs <6|7> <new-directory>");
const root = resolve(destination);
await mkdir(root);
const vertices = [],
  triangles = [];
for (let i = 0; i <= 18; i++) vertices.push([i * 5, -2], [i * 5, 2]);
for (let i = 0; i < 18; i++)
  triangles.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
const mesh = {
  schemaVersion: "0.1",
  kind: "mesh",
  id: "review-strip",
  name: "Original test strip",
  sourcePartId: "strip",
  vertices,
  uvs: vertices.map(([x, y]) => [x / 90, (y + 2) / 4]),
  triangles,
  hull: [
    ...Array.from({ length: 19 }, (_, i) => 2 * i),
    ...Array.from({ length: 19 }, (_, i) => 2 * (18 - i) + 1),
  ],
};
const rig = generateChainRig({
  id: "review-rig",
  name: "Review rig",
  start: [0, 0],
  end: [90, 0],
  boneCount: 3,
});
const weights = solveWeightsV1(mesh, rig, {
  maxInfluences: 2,
  smoothingPasses: 1,
  candidateRadius: gate === "7" ? 6 : Number.MAX_VALUE,
});
const wave = generateWave(rig, { duration: 2, fps: 24, amplitudeDegrees: 8, phaseDegrees: 45 });
const poses =
  gate === "6"
    ? [
        { label: "Setup", rotations: {} },
        { label: "Root 45°", rotations: { [rig.bones[0].id]: 45 } },
        { label: "Middle 30°", rotations: { [rig.bones[1].id]: 30 } },
        ...[0, 0.25, 0.5, 0.75, 1].map((t) => ({
          label: "Wave " + t + "s",
          rotations: rotationsAt(wave, t),
        })),
      ]
    : [0, 30, 60, 90, 120].map((a) => ({
        label: "Elbow " + a + "°",
        rotations: { [rig.bones[1].id]: a },
      }));
const samples = poses
  .map((p) => ({ ...p, vertices: skinVertices(mesh, rig, weights, p.rotations) }))
  .map((p) => ({ ...p, metrics: measureDeformation(mesh, p.vertices) }));
const summary = {
  gate: Number(gate),
  fixture: "synthetic three-bone strip, not artist anatomy",
  parameters: {
    maxInfluences: 2,
    smoothingPasses: 1,
    candidateRadius: gate === "7" ? 6 : "unbounded",
  },
  passed: samples.every((s) => deformationPasses(s.metrics)),
  samples,
  artistQualityAccepted: false,
};
await writeFile(resolve(root, "baseline.json"), JSON.stringify(summary, null, 2) + "\n", {
  flag: "wx",
});
const cards = samples
  .map((s) => {
    const lines = mesh.triangles
      .reduce((out, _, i) => {
        if (i % 3 === 0)
          out.push(
            `<polygon points="${mesh.triangles
              .slice(i, i + 3)
              .map((j) => s.vertices[j].join(","))
              .join(" ")}"/>`,
          );
        return out;
      }, [])
      .join("");
    const frames = evaluateRig(rig, s.rotations),
      bones = rig.bones
        .map((b) => {
          const h = transformPoint(frames.get(b.id), [0, 0]),
            t = transformPoint(frames.get(b.id), [b.length, 0]);
          return `<line x1="${h[0]}" y1="${h[1]}" x2="${t[0]}" y2="${t[1]}"/><circle cx="${h[0]}" cy="${h[1]}" r="1.2"/>`;
        })
        .join("");
    return `<section><h2>${s.label}</h2><svg viewBox="-10 -15 120 105" width="300" height="230"><g fill="#2391bf55" stroke="#74caff" stroke-width=".3">${lines}</g><g stroke="#ffc56b" fill="#ffc56b" stroke-width=".7">${bones}</g></svg><pre>${JSON.stringify(s.metrics, null, 2)}</pre></section>`;
  })
  .join("");
await writeFile(
  resolve(root, "review.html"),
  `<!doctype html><meta charset="utf-8"><title>Gate ${gate} deformation self-review</title><style>body{font:15px system-ui;background:#101827;color:#eaf2ff;margin:30px}main{display:flex;flex-wrap:wrap;gap:20px}section{padding:15px;background:#19283b;width:315px}h2{font-size:18px}pre{font-size:12px}</style><h1>Gate ${gate} · ${summary.passed ? "ENGINEERING PASS" : "FAILED"}</h1><p>Synthetic fixture; blue mesh / gold bones. Not Yuuna or artist-quality acceptance.</p><main>${cards}</main>`,
  { flag: "wx" },
);
console.log(
  JSON.stringify({ passed: summary.passed, path: root, metrics: samples.map((s) => s.metrics) }),
);
if (!summary.passed) process.exitCode = 1;
