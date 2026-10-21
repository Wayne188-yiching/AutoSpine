// Developer-only (ADR-041): rebuild every artist mesh of a Spine 3.8/4.0 export from its PNG with
// the artist skeleton's bones, and score it against the artist mesh. Prints numbers only; private
// exports and images stay where they are.
// Usage: node tools/artist-wiring-check.mjs [--budget=adr024] [--out=rows.json] <name>=<export.json>,<images-dir> ...
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import console from "node:console";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { PNG } from "pngjs";
import { encodeAlphaMask } from "@autospine/assets";
import { generateFeatureMesh } from "@autospine/mesh";
import {
  attachmentEntries,
  compareTypedEdges,
  compareVertexPositions,
  readArtistMesh,
} from "./reference-topology.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const corpora = args.filter((a) => !a.startsWith("--")).map((a) => a.split(/=(.*)/s));
if (!corpora.length)
  throw new Error("Usage: artist-wiring-check.mjs <name>=<export.json>,<images>");

/** Spine bone world matrices [a, b, c, d, x, y]: world = (a px + b py + x, c px + d py + y). */
function boneWorld(bones) {
  const out = new Map(),
    rad = (d) => ((d ?? 0) * Math.PI) / 180;
  for (const b of bones) {
    const r = rad(b.rotation),
      sx = b.scaleX ?? 1,
      sy = b.scaleY ?? 1;
    const la = Math.cos(r + rad(b.shearX)) * sx,
      lb = Math.cos(r + Math.PI / 2 + rad(b.shearY)) * sy,
      lc = Math.sin(r + rad(b.shearX)) * sx,
      ld = Math.sin(r + Math.PI / 2 + rad(b.shearY)) * sy;
    const [pa, pb, pc, pd, px, py] = b.parent ? out.get(b.parent) : [1, 0, 0, 1, 0, 0];
    const x = b.x ?? 0,
      y = b.y ?? 0;
    out.set(b.name, [
      pa * la + pb * lc,
      pa * lb + pb * ld,
      pc * la + pd * lc,
      pc * lb + pd * ld,
      pa * x + pb * y + px,
      pc * x + pd * y + py,
    ]);
  }
  return out;
}
const apply = (m, [x, y]) => [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];

/** Least-squares affine from image pixels to world, inverted: world point to image pixel. */
function worldToImage(image, world) {
  const solve = (k) => {
    // Normal equations of [x y 1] . c = world[k].
    const A = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      r = [0, 0, 0];
    image.forEach(([x, y], i) => {
      const v = [x, y, 1];
      for (let p = 0; p < 3; p++) {
        r[p] += v[p] * world[i][k];
        for (let q = 0; q < 3; q++) A[p][q] += v[p] * v[q];
      }
    });
    const det = (m) =>
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    return [0, 1, 2]
      .map((c) => det(A.map((row, i) => row.map((v, j) => (j === c ? r[i] : v))))) // Cramer
      .map((v) => v / D);
  };
  const [a, b, x] = solve(0),
    [c, d, y] = solve(1),
    det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (b * y - d * x) / det, (c * x - a * y) / det];
}

async function imageIndex(dir) {
  const files = new Map();
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".png")) {
        const rel = relative(dir, p).replace(/\\/g, "/").slice(0, -4);
        files.set(rel, p);
        if (!files.has(e.name.slice(0, -4))) files.set(e.name.slice(0, -4), p);
      }
    }
  };
  await walk(dir);
  return files;
}

/** Old ADR-024 budget, as explicit counts. */
const adr024 = (w, h) => {
  const s = Math.sqrt(w * h);
  return {
    hullVertices: Math.min(40, Math.max(6, Math.round(Math.sqrt(s)))),
    interiorVertices: s < 100 ? 0 : Math.round(s / 80),
  };
};
const nearest = (a, b) =>
  a.reduce((s, p) => s + Math.min(...b.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))), 0) /
  a.length;
/** Share of free interior edges (not hull, not manual) whose opposite angles sum to at most 180. */
function delaunayShare(m) {
  const fixed = new Set(
    [...m.hull.map((a, i) => [a, m.hull[(i + 1) % m.hull.length]]), ...m.manualEdges].map(
      ([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`,
    ),
  );
  const angles = new Map();
  for (let t = 0; t < m.triangles.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const [a, b, c] = [0, 1, 2].map((j) => m.vertices[m.triangles[t + ((k + j) % 3)]]),
        key = [m.triangles[t + k], m.triangles[t + ((k + 1) % 3)]].sort((x, y) => x - y).join(":");
      const u = [a[0] - c[0], a[1] - c[1]],
        w = [b[0] - c[0], b[1] - c[1]];
      angles.set(key, [
        ...(angles.get(key) ?? []),
        Math.acos(
          Math.max(
            -1,
            Math.min(1, (u[0] * w[0] + u[1] * w[1]) / Math.hypot(...u) / Math.hypot(...w)),
          ),
        ),
      ]);
    }
  const free = [...angles].filter(([key, v]) => v.length === 2 && !fixed.has(key));
  return free.length
    ? free.filter(([, [x, y]]) => x + y <= Math.PI + 1e-3).length / free.length
    : undefined;
}

/** Hull edge lengths over their mean: coefficient of variation, and the share under half (ADR-043). */
function hullSpacing(m) {
  const l = m.hull.map((a, i) => {
      const p = m.vertices[a],
        q = m.vertices[m.hull[(i + 1) % m.hull.length]];
      return Math.hypot(p[0] - q[0], p[1] - q[1]);
    }),
    mean = l.reduce((s, x) => s + x, 0) / l.length;
  return {
    cv: Math.sqrt(l.reduce((s, x) => s + (x - mean) ** 2, 0) / l.length) / mean,
    short: l.filter((x) => x < 0.5 * mean).length / l.length,
  };
}

const rows = [];
for (const [name, spec] of corpora) {
  const [jsonPath, imagesDir] = spec.split(",");
  const doc = JSON.parse((await readFile(jsonPath, "utf8")).trimStart()); // a BOM
  const version = doc.skeleton?.spine,
    names = doc.bones.map((b) => b.name),
    parent = new Map(doc.bones.map((b) => [b.name, b.parent])),
    world = boneWorld(doc.bones),
    length = new Map(doc.bones.map((b) => [b.name, b.length ?? 0])),
    images = await imageIndex(imagesDir);
  // Attachments an animation deforms by keys (Spine 3.8/4.0 `deform`, older `ffd`).
  const keyed = new Set(
    Object.values(doc.animations ?? {}).flatMap((anim) =>
      Object.values(anim.deform ?? anim.ffd ?? {}).flatMap((slots) =>
        Object.entries(slots).flatMap(([slot, atts]) =>
          Object.keys(atts).map((k) => `${slot}/${k}`),
        ),
      ),
    ),
  );
  for (const { slot, name: att, attachment: a } of attachmentEntries(doc)) {
    if (a.type !== "mesh") continue;
    const row = { corpus: name, slot, attachment: att };
    rows.push(row);
    try {
      const file = images.get(a.path ?? att) ?? images.get((a.path ?? att).split("/").at(-1));
      if (!file) throw new Error("NO_IMAGE");
      const png = PNG.sync.read(await readFile(file)),
        { width, height } = png;
      if (a.width && (a.width !== width || a.height !== height)) throw new Error("SIZE_MISMATCH");
      const alpha = Uint8Array.from({ length: width * height }, (_, i) => png.data[i * 4 + 3]);
      const artist = readArtistMesh(a, width, height, version);
      artist.manualEdges ??= [];
      // Bones that weight the mesh, in image pixels; a joint when its parent also weights it.
      const n = a.uvs.length / 2,
        bones = [];
      if (a.vertices.length > 2 * n) {
        const pos = [],
          used = new Set();
        for (let i = 0; i < a.vertices.length;) {
          const k = a.vertices[i++],
            p = [0, 0];
          for (let j = 0; j < k; j++, i += 4) {
            const [b, x, y, w] = a.vertices.slice(i, i + 4),
              q = apply(world.get(names[b]), [x, y]);
            p[0] += w * q[0];
            p[1] += w * q[1];
            if (w > 0.01) used.add(names[b]);
          }
          pos.push(p);
        }
        const toImage = worldToImage(artist.vertices, pos);
        for (const b of used) {
          const m = world.get(b);
          bones.push({
            origin: apply(toImage, apply(m, [0, 0])),
            tip: apply(toImage, apply(m, [length.get(b), 0])),
            joint: used.has(parent.get(b)),
          });
        }
      }
      const deforms = keyed.has(`${slot}/${att}`);
      const options =
        flag("budget") === "adr024"
          ? adr024(width, height)
          : { bones, ...(deforms ? { deforms } : {}) };
      const t0 = performance.now();
      const { mesh } = generateFeatureMesh(
        {
          id: "p",
          name: "p",
          sourcePath: "p.png",
          drawOrder: 0,
          bounds: { x: 0, y: 0, width, height },
          alphaMask: encodeAlphaMask(width, height, alpha),
        },
        alpha,
        options,
      );
      const ms = performance.now() - t0;
      const generated = {
        vertices: mesh.uvs.map(([u, v]) => [u * width, v * height]),
        hull: mesh.hull,
        triangles: mesh.triangles,
        manualEdges: mesh.manualEdges ?? [],
      };
      const positions = compareVertexPositions(artist, generated, width, height),
        edges = compareTypedEdges(artist, generated, positions.pairs),
        diagonal = Math.hypot(width, height);
      // Hull padding: hull vertex to the nearest opaque (alpha > 8) boundary pixel centre.
      const edge = [];
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (
            alpha[y * width + x] > 8 &&
            [
              [x + 1, y],
              [x - 1, y],
              [x, y + 1],
              [x, y - 1],
            ].some(
              ([u, v]) => u < 0 || v < 0 || u >= width || v >= height || alpha[v * width + u] <= 8,
            )
          )
            edge.push([x + 0.5, y + 0.5]);
      const pad = (m) => {
        const d = m.hull.map((i) => nearest([m.vertices[i]], edge)).sort((x, y) => x - y);
        return d[Math.floor(d.length / 2)];
      };
      Object.assign(row, {
        width,
        height,
        bones: bones.length,
        deforms,
        joints: bones.filter((b) => b.joint).length,
        artistHull: artist.hull.length,
        generatedHull: mesh.hull.length,
        artistInterior: artist.vertices.length - artist.hull.length,
        generatedInterior: mesh.vertices.length - mesh.hull.length,
        // Symmetric mean nearest-vertex distance over all vertices, PNG diagonal.
        position:
          (nearest(artist.vertices, generated.vertices) +
            nearest(generated.vertices, artist.vertices)) /
          2 /
          diagonal,
        hullMax: positions.groups.hull.max,
        hullRecall: edges.hull?.recall,
        automaticRecall: edges.automatic?.recall,
        artistPad: pad(artist),
        generatedPad: pad(generated),
        artistSpacing: hullSpacing(artist),
        generatedSpacing: hullSpacing(generated),
        artistDelaunay: delaunayShare(artist),
        generatedDelaunay: delaunayShare(generated),
        ms: Math.round(ms),
      });
    } catch (error) {
      row.error = error.message;
    }
  }
}

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : NaN;
};
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");
console.log(
  "corpus     meshes  |hull err| med/mean  hull within 25%  |interior err| med  position %diag med/mean  hull max %diag med  hull recall  auto recall  pad px artist/gen  hull edge CV artist/gen  short edges artist/gen  Delaunay artist/gen  ms",
);
for (const group of [...corpora.map(([n]) => n), "all"]) {
  const r = rows.filter((x) => !x.error && (group === "all" || x.corpus === group));
  if (!r.length) continue;
  const he = r.map((x) => Math.abs(x.generatedHull - x.artistHull) / x.artistHull);
  console.log(
    [
      group.padEnd(10),
      String(r.length).padStart(6),
      `${f(median(he))}/${f(mean(he))}`.padStart(20),
      `${f(100 * mean(he.map((e) => +(e <= 0.25))), 0)}%`.padStart(17),
      f(median(r.map((x) => Math.abs(x.generatedInterior - x.artistInterior))), 1).padStart(20),
      `${f(100 * median(r.map((x) => x.position)))}/${f(100 * mean(r.map((x) => x.position)))}`.padStart(
        25,
      ),
      f(100 * median(r.map((x) => x.hullMax))).padStart(20),
      f(mean(r.map((x) => x.hullRecall)), 3).padStart(12),
      f(
        mean(r.filter((x) => Number.isFinite(x.automaticRecall)).map((x) => x.automaticRecall)),
        3,
      ).padStart(12),
      `${f(median(r.map((x) => x.artistPad)), 1)}/${f(median(r.map((x) => x.generatedPad)), 1)}`.padStart(
        19,
      ),
      `${f(median(r.map((x) => x.artistSpacing.cv)))}/${f(median(r.map((x) => x.generatedSpacing.cv)))}`.padStart(
        24,
      ),
      [r.map((x) => x.artistSpacing.short), r.map((x) => x.generatedSpacing.short)]
        .map((d) => f(100 * mean(d), 0) + "%")
        .join("/")
        .padStart(24),
      [r.map((x) => x.artistDelaunay), r.map((x) => x.generatedDelaunay)]
        .map((d) => f(100 * mean(d.filter(Number.isFinite)), 0) + "%")
        .join("/")
        .padStart(20),
      String(Math.round(median(r.map((x) => x.ms)))).padStart(4),
    ].join(" "),
  );
}
const failed = rows.filter((x) => x.error);
if (failed.length)
  console.log(
    `skipped ${failed.length}:`,
    Object.entries(Object.groupBy(failed, (x) => x.error))
      .map(([e, v]) => `${e} ${v.length}`)
      .join(", "),
  );
if (flag("out")) await writeFile(flag("out"), JSON.stringify(rows, null, 1));
