import { describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCharacterFiles, deliverFiles } from "@autospine/cli/character";
import { checkDeliveryFiles } from "@autospine/cli/delivery";
import { AutoSpineMcpServer, mcpTools } from "@autospine/mcp";
import { comparePlayback } from "@autospine/reference";
import { checkDelivery, isTextOrNumber, withActorBone } from "@autospine/spine";
import { fixtureWorkspace } from "./character-fixture.js";

type Json = Record<string, unknown>;
const ids = (rows: { id: string; level: string }[], level: string) =>
  [...new Set(rows.filter((r) => r.level === level).map((r) => r.id))].sort();

/** A small skeleton that keeps every convention: root, Actor, one weighted mesh, a loop. */
function clean(): Json {
  return {
    skeleton: { spine: "4.0.56", images: "./images/" },
    bones: [
      { name: "root" },
      { name: "Actor", parent: "root" },
      { name: "body", parent: "Actor", length: 50, rotation: 90 },
      { name: "head", parent: "body", x: 50, length: 20 },
    ],
    slots: [
      { name: "Body", bone: "body", attachment: "Body" },
      { name: "Glow_Add", bone: "head", attachment: "Glow", blend: "additive" },
    ],
    skins: [
      {
        name: "default",
        attachments: {
          Body: {
            Body: {
              type: "mesh",
              uvs: [0, 0, 1, 0, 1, 1, 0, 1],
              triangles: [0, 1, 2, 0, 2, 3],
              // [count, bone, x, y, weight, ...]: two bones per vertex.
              vertices: [
                2, 2, -10, -10, 0.5, 3, -10, -60, 0.5, 2, 2, 10, -10, 0.5, 3, 10, -60, 0.5, 2, 2,
                10, 10, 0.5, 3, 10, -40, 0.5, 2, 2, -10, 10, 0.5, 3, -10, -40, 0.5,
              ],
              hull: 4,
              width: 20,
              height: 20,
            },
          },
          Glow_Add: { Glow: { width: 10, height: 10 } },
        },
      },
    ],
    animations: {
      Win_Loop: {
        bones: {
          head: {
            rotate: [{ value: 0 }, { time: 0.5, value: 10 }, { time: 1, value: 0 }],
          },
        },
        slots: { Glow_Add: { rgba: [{ color: "ffffffff" }, { time: 1, color: "ffffffff" }] } },
      },
      Win_In: {
        bones: { head: { rotate: [{ value: 0 }, { time: 0.5, value: 5 }] } },
        slots: { Glow_Add: { rgba: [{ color: "ffffff00" }, { time: 0.5, color: "ffffffff" }] } },
      },
    },
  };
}

describe("delivery conventions (ADR-053)", () => {
  it("passes a skeleton that keeps them", () => {
    const check = checkDelivery(clean(), "unity", { kind: "symbol-high" });
    expect(check.rows).toEqual([]);
    expect(check).toMatchObject({
      pass: true,
      counts: { bones: 4, setupTriangles: 4, drawCalls: 2, clipping: 0, maxWeightBones: 2 },
      limits: { bones: 30, setupTriangles: 150, drawCalls: 4 },
    });
  });

  it("reports each broken rule by its id", () => {
    const doc = clean();
    const bones = doc.bones as Json[];
    bones[0]!.x = 5; // R1
    bones.push({ name: "Prop", parent: "root" }, { name: "_guide", parent: "root" }); // R3, not _guide
    bones.push({ name: "HP_value", parent: "Actor" }, { name: "坐標", parent: "Actor" }); // N1
    for (const n of ["a", "b", "c"]) bones.push({ name: n, parent: "Actor" }); // L1: 11 bones
    const slots = doc.slots as Json[];
    slots.push(
      { name: "Shine", bone: "head", attachment: "Shine", blend: "screen" }, // S1
      { name: "Light", bone: "head", attachment: "Light", blend: "additive" }, // S2
      { name: "Empty", bone: "head" }, // S5
      { name: "Value", bone: "HP_value", attachment: "HP_NUM1" }, // T1: no leading _, moved
      { name: "Icon", bone: "HP_value", attachment: "Icon" }, // T1: HP_ holds an image
      { name: "Mask", bone: "head", attachment: "Mask" },
      { name: "Mask2", bone: "head", attachment: "Mask2" },
      { name: "Spot", bone: "head", attachment: "Spot" },
    );
    const skin = (doc.skins as Json[])[0]!.attachments as Record<string, Json>;
    Object.assign(skin, {
      Shine: { Shine: {} },
      Light: { Light: {} },
      Value: { HP_NUM1: { x: 3 } },
      Icon: { Icon: {} },
      Mask: { Mask: { type: "clipping", end: "Spot", vertexCount: 9, vertices: [] } }, // S4
      Mask2: { Mask2: { type: "clipping", end: "Spot", vertexCount: 4, vertices: [] } },
      Spot: { Spot: { type: "point" } }, // S3
    });
    const anims = doc.animations as Record<string, Json>;
    anims.Win_Loop!.bones = {
      root: { rotate: [{ value: 0 }] }, // R2
      head: { rotate: [{ value: 0 }, { time: 1, value: 10 }] }, // A2: the loop jumps
    };
    // A1: no key on frame 0; T1: a number shown by attachment keys; A3: Win_In keys less.
    anims.Win_Loop!.slots = {
      Glow_Add: { rgba: [{ time: 0.2, color: "ffffffff" }] },
      Value: { attachment: [{ name: null }] },
    };
    // W1: six bones on one vertex.
    (skin.Body!.Body as Json).vertices = [
      6, 0, 0, 0, 0.2, 1, 0, 0, 0.2, 2, 0, 0, 0.2, 3, 0, 0, 0.2, 4, 0, 0, 0.1, 5, 0, 0, 0.1, 1, 2,
      0, 0, 1, 1, 2, 0, 0, 1, 1, 2, 0, 0, 1,
    ];
    const check = checkDelivery(doc, "cocos", { kind: "symbol-low" });
    expect(ids(check.rows, "error")).toEqual([
      "L1",
      "L2",
      "L3",
      "N1",
      "R1",
      "R2",
      "R3",
      "S1",
      "S2",
      "S3",
      "S4",
      "T1",
      "V1",
      "W1",
    ]);
    expect(ids(check.rows, "warning")).toEqual(["A1", "A2", "A3", "S5"]);
    expect(check.pass).toBe(false);
    expect(check.rows.find((r) => r.id === "R3")!.message).toContain("Prop");
    expect(check.rows.find((r) => r.id === "R3")!.message).not.toContain("_guide");
    // Unity takes no clipping and needs an image in the setup pose (U1).
    const unity = checkDelivery(doc, "unity");
    expect(unity.rows.filter((r) => r.id === "S4")[0]!.message).toContain("takes none");
    const dark = clean();
    for (const s of dark.slots as Json[]) s.blend = "additive";
    expect(ids(checkDelivery(dark, "unity").rows, "error")).toContain("U1");
    // A larger board lowers the symbol limits.
    expect(
      checkDelivery(clean(), "unity", { kind: "symbol-mid", largeBoard: true }).limits,
    ).toEqual({ bones: 20, setupTriangles: 30, maskTriangles: 0, drawCalls: 1, atlasPage: 256 });
  });

  it("checks win tiers, loading pages and text names", () => {
    const win = clean();
    win.animations = { BigWin_Start: {}, BigWin_End: {}, MegaWin_Start: {}, Idle: {} };
    const rows = checkDelivery(win, "unity", { kind: "bigwin" }).rows;
    expect(rows.map((r) => r.message)).toEqual([
      "MegaWin_End is missing",
      "animations outside the tier names: Idle",
    ]);
    const loading = clean();
    (loading.bones as Json[]).splice(1, 3, { name: "Page_01", parent: "root" });
    (loading.bones as Json[]).push({ name: "Text", parent: "Page_01", rotation: 0 });
    loading.slots = [{ name: "Body", bone: "Page_01", attachment: "Body" }];
    loading.animations = { Page_01: {}, Intro: {} };
    expect(checkDelivery(loading, "cocos", { kind: "loading", version: "3.8.99" }).rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "K1", message: expect.stringContaining("Intro") }),
        expect.objectContaining({
          id: "K1",
          level: "error",
          message: expect.stringContaining("Text"),
        }),
      ]),
    );
    expect(isTextOrNumber("_HP_TEXT1")).toBe(true);
    expect(isTextOrNumber("lang/_NUM_2")).toBe(true);
    expect(isTextOrNumber("Numa_arm")).toBe(false);
  });

  it("puts an Actor bone under the root without moving anything", async () => {
    const doc = clean();
    const bones = doc.bones as Json[];
    // The artist's layout: a moved, keyed root holding the bones and a slot.
    bones.splice(1, 1);
    bones[1]!.parent = "root";
    Object.assign(bones[0]!, { x: 30, y: -12, rotation: 20, scaleX: 1.5 });
    (doc.slots as Json[]).push({ name: "Shadow", bone: "root", attachment: "Shadow" });
    ((doc.skins as Json[])[0]!.attachments as Json).Shadow = { Shadow: { width: 8, height: 4 } };
    const body = (doc.skins as Json[])[0]!.attachments as Record<string, Record<string, Json>>;
    body.Body!.Body!.vertices = (body.Body!.Body!.vertices as number[]).map((v, i) =>
      // Bone indices one lower: there is no Actor yet.
      i % 9 === 1 || i % 9 === 5 ? v - 1 : v,
    );
    (doc.animations as Record<string, Json>).Win_Loop!.bones = {
      root: { translate: [{ x: 0 }, { time: 0.5, x: 20 }, { time: 1, x: 0 }] },
      head: { rotate: [{ value: 0 }, { time: 1, value: 0 }] },
    };
    delete (doc.animations as Json).Win_In;
    doc.ik = [{ name: "aim", bones: ["head"], target: "root" }];
    expect(ids(checkDelivery(doc, "unity").rows, "error")).toEqual(["R1", "R2", "R3"]);

    const wrapped = withActorBone(doc);
    expect(wrapped).not.toBe(doc);
    expect(checkDelivery(wrapped, "unity").rows).toEqual([]);
    expect((wrapped.bones as Json[]).slice(0, 3)).toEqual([
      { name: "root" },
      { name: "Actor", parent: "root", x: 30, y: -12, rotation: 20, scaleX: 1.5 },
      { name: "body", parent: "Actor", length: 50, rotation: 90 },
    ]);
    expect((wrapped.ik as Json[])[0]!.target).toBe("Actor");
    for (const d of comparePlayback(doc, wrapped)) expect(d.max).toBeLessThan(1e-6);
    expect(withActorBone(wrapped)).toBe(wrapped);
  });

  // Spine.com stands in as a shell script; Windows does not spawn scripts without a shell.
  it.skipIf(process.platform === "win32")(
    "delivers for a runtime: its editor version, an Actor bone and the check",
    async () => {
      const ws = await fixtureWorkspace();
      const plan = join(ws, "plan.json");
      await buildCharacterFiles(plan, join(ws, "build"));
      const built = JSON.parse(await readFile(join(ws, "build", "fixture_character.json"), "utf8"));
      // Stands in for Spine.com: keeps the imported skeleton as the "project".
      const spine = join(ws, "fake-spine");
      const script = join(ws, "fake-spine.cjs");
      await writeFile(
        script,
        `const fs = require("node:fs");
const a = process.argv.slice(2);
fs.writeFileSync(a[a.indexOf("-o") + 1], JSON.stringify({ args: a, doc: JSON.parse(fs.readFileSync(a[a.indexOf("-i") + 1], "utf8")) }));
`,
      );
      await writeFile(spine, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
      await chmod(spine, 0o755);
      const out = join(ws, "Delivery");
      const result = await deliverFiles(plan, join(ws, "build"), out, undefined, {
        spine,
        video: false,
        target: "unity",
        kind: "character",
      });
      expect(result.spineVersion).toBe("4.0.56");
      expect(result.check).toMatchObject({ target: "unity", kind: "character", pass: true });
      const project = JSON.parse(await readFile(result.spine!, "utf8")) as {
        args: string[];
        doc: { bones: Json[] };
      };
      expect(project.args[project.args.indexOf("-u") + 1]).toBe("4.0.56");
      expect(project.doc.bones[1]).toEqual({ name: "Actor", parent: "root" });
      expect(comparePlayback(built, project.doc).every((d) => d.max < 1e-6)).toBe(true);
    },
    120_000,
  );

  it("checks the runtime export folder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autospine-delivery-check-"));
    const json = join(dir, "Wild.json");
    await writeFile(json, JSON.stringify(clean()));
    const exp = join(dir, "Export");
    await mkdir(exp);
    await writeFile(join(exp, "Wild.skel"), Buffer.from("\u0000\u00083.8.99\u0000rest"));
    await writeFile(
      join(exp, "Wild.atlas"),
      "\nWild.png\nsize: 2048,1024\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nBody\n  rotate: false\n  xy: 2, 2\n_guide\n  rotate: false\n",
    );
    const cocos = await checkDeliveryFiles(json, "cocos", { kind: "wild", exportDir: exp });
    expect(cocos.rows.filter((r) => r.id.startsWith("E"))).toEqual([
      { id: "E2", level: "warning", message: "Wild.png is 2048x1024; wild pages are 512 at most" },
      {
        id: "E3",
        level: "warning",
        message: "image _guide starts with _ (a reference image?); turn its export off",
      },
    ]);
    const unity = await checkDeliveryFiles(json, "unity", { exportDir: exp });
    expect(ids(unity.rows, "error")).toEqual(["E1", "E2"]);
  });

  it("is a read-only MCP tool", async () => {
    expect(mcpTools.find((t) => t.name === "autospine_check_delivery")!.annotations).toMatchObject({
      readOnlyHint: true,
    });
    const ws = await mkdtemp(join(tmpdir(), "autospine-mcp-delivery-"));
    await writeFile(join(ws, "skeleton.json"), JSON.stringify(clean()));
    const server = new AutoSpineMcpServer(ws);
    await server.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    });
    await server.receive({ jsonrpc: "2.0", method: "notifications/initialized" });
    const r = (await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "autospine_check_delivery",
        arguments: { skeletonPath: "skeleton.json", target: "cocos", kind: "wild" },
      },
    })) as { result: { isError?: boolean; structuredContent: Json } };
    expect(r.result.isError).not.toBe(true);
    expect(r.result.structuredContent).toMatchObject({
      skeletonPath: "skeleton.json",
      target: "cocos",
      pass: false,
      rows: [{ id: "V1", level: "error" }],
    });
  });
});
