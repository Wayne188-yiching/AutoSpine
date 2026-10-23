import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  buildCharacterFiles,
  deliverFiles,
  initProjectFolder,
  spineVersionArg,
} from "@autospine/cli/character";
import { AUTOSPINE_VERSION } from "@autospine/cli/version";
import { forEditorVersion } from "@autospine/spine";
import { fixtureWorkspace } from "./character-fixture.js";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

/** Stands in for Spine.com: records its arguments and the imported skeleton as the "project". */
async function fakeSpine(dir: string) {
  const exe = join(dir, "fake-spine");
  await writeFile(
    exe,
    `#!/usr/bin/env node
const fs = require("node:fs");
const a = process.argv.slice(2);
const doc = JSON.parse(fs.readFileSync(a[a.indexOf("-i") + 1], "utf8"));
fs.writeFileSync(a[a.indexOf("-o") + 1], JSON.stringify({ args: a, images: doc.skeleton.images }));
`,
  );
  await chmod(exe, 0o755);
  return exe;
}

describe("deliver: the project folder holds only the Spine project, its images and the video", () => {
  it.skipIf(process.platform === "win32")(
    "writes <name>.spine, images/ and <name>.mp4",
    async () => {
      const ws = await fixtureWorkspace();
      const plan = join(ws, "plan.json");
      await buildCharacterFiles(plan, join(ws, "build"));
      const spine = await fakeSpine(ws);
      const delivery = join(ws, "Character", "AutoSpine");
      const video = hasFfmpeg;

      const first = await deliverFiles(plan, join(ws, "build"), delivery, undefined, {
        name: "Fixture_Idle",
        spine,
        video,
      });
      const expected = [
        "_work",
        "Fixture_Idle.spine",
        "images",
        ...(video ? ["Fixture_Idle.mp4"] : []),
      ];
      expect((await readdir(delivery)).sort()).toEqual(expected.sort());
      expect((await readdir(join(delivery, "images"))).sort()).toEqual(
        (await readdir(join(ws, "images"))).sort(),
      );
      expect(first.replaced).toBeNull();
      const project = JSON.parse(await readFile(join(delivery, "Fixture_Idle.spine"), "utf8")) as {
        args: string[];
        images: string;
      };
      // The art travels with the project.
      expect(project.images).toBe("./images/");
      expect(project.args).toEqual(expect.arrayContaining(["-u", "4.0.64", "-r", "Fixture_Idle"]));

      // A second delivery needs --replace; the old files move into the build folder.
      await expect(
        deliverFiles(plan, join(ws, "build"), delivery, undefined, {
          name: "Fixture_Idle",
          spine,
          video,
        }),
      ).rejects.toThrow("CLI_OUTPUT_EXISTS");
      const second = await deliverFiles(plan, join(ws, "build"), delivery, undefined, {
        name: "Fixture_Idle",
        spine,
        video,
        replace: true,
      });
      expect((await readdir(delivery)).sort()).toEqual(expected.sort());
      // The old project and video move away; images/ and _work/ (the delivery record) stay.
      const replacedFiles = expected.filter((f) => f !== "images" && f !== "_work");
      expect((await readdir(second.replaced!)).sort()).toEqual(replacedFiles.sort());

      if (video) {
        // A delivery from before the record (0.5.6) falls back on the project being saved more
        // than two minutes after its video.
        await rm(join(delivery, "_work", "delivery.json"));
        const later = new Date(Date.now() + 10 * 60_000);
        await utimes(join(delivery, "Fixture_Idle.spine"), later, later);
        await expect(
          deliverFiles(plan, join(ws, "build"), delivery, undefined, {
            name: "Fixture_Idle",
            spine,
            replace: true,
          }),
        ).rejects.toThrow("CLI_DELIVER_EDITED");
        await deliverFiles(plan, join(ws, "build"), delivery, undefined, {
          name: "Fixture_Idle",
          spine,
          replace: true,
          force: true,
        });
        expect((await readdir(delivery)).sort()).toEqual(expected.sort());
        // With the record, a project saved later but unchanged is not taken for an edit.
        await utimes(join(delivery, "Fixture_Idle.spine"), later, later);
        await deliverFiles(plan, join(ws, "build"), delivery, undefined, {
          name: "Fixture_Idle",
          spine,
          replace: true,
        });
      }
    },
    180_000,
  );

  it("falls back to <name>.json for Import Data when the Spine editor is not installed", async () => {
    const ws = await fixtureWorkspace();
    const plan = join(ws, "plan.json");
    await buildCharacterFiles(plan, join(ws, "build"));
    const delivery = await mkdtemp(join(tmpdir(), "autospine-delivery-"));
    const saved = process.env.AUTOSPINE_SPINE;
    delete process.env.AUTOSPINE_SPINE;
    try {
      const result = await deliverFiles(plan, join(ws, "build"), delivery, undefined, {
        video: false,
      });
      if (result.spine) return; // a real Spine install on this machine
      expect((await readdir(delivery)).sort()).toEqual([
        "_work",
        "fixture_character.json",
        "images",
      ]);
      const doc = JSON.parse(await readFile(result.json!, "utf8")) as {
        skeleton: { images: string };
      };
      expect(doc.skeleton.images).toBe("./images/");
    } finally {
      if (saved !== undefined) process.env.AUTOSPINE_SPINE = saved;
    }
    // An explicit editor that is missing is an error, not a silent fallback.
    await expect(
      deliverFiles(plan, join(ws, "build"), delivery, undefined, {
        video: false,
        spine: join(ws, "no-such-spine"),
        replace: true,
      }),
    ).rejects.toThrow("CLI_SPINE");
  }, 120_000);

  it("imports the project with a chosen editor version, 3.8 or newer", async () => {
    expect(spineVersionArg(undefined)).toBe("4.0.64");
    expect(spineVersionArg("4.2")).toBe("4.2");
    expect(spineVersionArg("4.2.43")).toBe("4.2.43");
    expect(spineVersionArg("3.8")).toBe("3.8");
    expect(spineVersionArg("3.8.99")).toBe("3.8.99");
    expect(() => spineVersionArg("latest")).toThrow("CLI_SPINE_VERSION");
    expect(() => spineVersionArg("3.7.94")).toThrow(/older than 3.8/);
    // Refused before the fit, the videos or any file is written.
    const ws = await fixtureWorkspace();
    const plan = join(ws, "plan.json");
    await buildCharacterFiles(plan, join(ws, "build"));
    const delivery = join(ws, "Character", "AutoSpine");
    await expect(
      deliverFiles(plan, join(ws, "build"), delivery, undefined, { spineVersion: "4.x" }),
    ).rejects.toThrow("CLI_SPINE_VERSION");
    await expect(readdir(delivery)).rejects.toThrow();
  }, 120_000);

  it("writes a 4.0 document in the 3.8 layout (ADR-047)", () => {
    // Every channel eased the same way (fractions 0.25, 0, 0.75, 1 of the segment).
    const ease = (t0: number, t1: number, v0: number, v1: number) => [
      t0 + 0.25 * (t1 - t0),
      v0,
      t0 + 0.75 * (t1 - t0),
      v1,
    ];
    const doc = {
      skeleton: { spine: "4.0.64" },
      bones: [{ name: "root" }, { name: "a", parent: "root" }, { name: "b", parent: "root" }],
      transform: [
        {
          name: "tc",
          bones: ["a"],
          target: "b",
          mixRotate: 0.5,
          mixX: 0.3,
          mixScaleX: 0.2,
          mixShearY: 0,
        },
      ],
      animations: {
        anim: {
          bones: {
            a: {
              rotate: [
                { value: 0, curve: ease(0, 1, 0, 10) },
                { time: 1, value: 10, curve: "stepped" },
                { time: 2, value: 5 },
              ],
              translate: [
                { x: 0, y: 0, curve: [...ease(0, 2, 0, 20), ...ease(0, 2, 0, -10)] },
                { time: 2, x: 20, y: -10 },
              ],
              // x eases in and out, y eases out: one 3.8 curve cannot hold both.
              scale: [
                { x: 1, y: 1, curve: [...ease(0, 1, 1, 2), 0.25, 2, 0.75, 2] },
                { time: 1, x: 2, y: 2 },
              ],
            },
          },
          slots: {
            s: {
              attachment: [{ name: "img" }],
              rgba: [
                {
                  color: "ffffffff",
                  curve: [
                    ...ease(0, 1, 1, 1),
                    ...ease(0, 1, 1, 1),
                    ...ease(0, 1, 1, 1),
                    ...ease(0, 1, 1, 0),
                  ],
                },
                { time: 1, color: "ffffff00" },
              ],
            },
          },
          deform: {
            default: {
              s: {
                img: [
                  { vertices: [1, 2], curve: [0.5, 0.2, 1.5, 0.8] },
                  { time: 2, vertices: [3, 4] },
                ],
              },
            },
          },
          ik: {
            leg: [
              { mix: 1, bendPositive: false, curve: [...ease(0, 1, 1, 0), ...ease(0, 1, 0, 0)] },
              { time: 1, mix: 0 },
            ],
          },
          transform: {
            tc: [
              {
                mixRotate: 1,
                mixX: 1,
                mixScaleX: 1,
                mixShearY: 1,
                // mixY (third) eased differently: 3.8 has no y mix, so it must not count.
                curve: [
                  ...ease(0, 1, 1, 0),
                  ...ease(0, 1, 1, 0),
                  0.1,
                  1,
                  0.9,
                  0,
                  ...ease(0, 1, 1, 0),
                  ...ease(0, 1, 1, 0),
                  ...ease(0, 1, 1, 0),
                ],
              },
              { time: 1, mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 },
            ],
          },
        },
      },
    };
    const before = JSON.stringify(doc);
    const out = forEditorVersion(doc, "3.8.99") as unknown as {
      skeleton: { spine: string };
      transform: Record<string, unknown>[];
      animations: { anim: Record<string, Record<string, Record<string, unknown>>> };
    };
    const shape = { curve: 0.25, c2: 0, c3: 0.75, c4: 1 };
    expect(out.skeleton.spine).toBe("3.8.99");
    expect(out.transform).toEqual([
      {
        name: "tc",
        bones: ["a"],
        target: "b",
        rotateMix: 0.5,
        translateMix: 0.3,
        scaleMix: 0.2,
        shearMix: 0,
      },
    ]);
    const a = out.animations.anim.bones!.a!;
    expect(a.rotate).toEqual([
      { angle: 0, ...shape },
      { time: 1, angle: 10, curve: "stepped" },
      { time: 2, angle: 5 },
    ]);
    expect(a.translate).toEqual([
      { x: 0, y: 0, ...shape },
      { time: 2, x: 20, y: -10 },
    ]);
    // Written as linear keys every 1/30 s: x on its ease, y reaching 2 sooner.
    const scale = a.scale as { time?: number; x: number; y: number; curve?: unknown }[];
    expect(scale).toHaveLength(31);
    expect(scale.every((k) => k.curve === undefined)).toBe(true);
    const half = scale.find((k) => Math.abs((k.time ?? 0) - 0.5) < 1e-6)!;
    expect(half.x).toBeCloseTo(1.5, 6);
    expect(half.y).toBeGreaterThan(1.8);
    const s = out.animations.anim.slots!.s!;
    expect(s.rgba).toBeUndefined();
    expect(s.color).toEqual([
      { color: "ffffffff", ...shape },
      { time: 1, color: "ffffff00" },
    ]);
    expect(s.attachment).toEqual([{ name: "img" }]);
    expect(out.animations.anim.deform!.default!.s).toEqual({
      img: [
        { vertices: [1, 2], curve: 0.25, c2: 0.2, c3: 0.75, c4: 0.8 },
        { time: 2, vertices: [3, 4] },
      ],
    });
    expect(out.animations.anim.ik!.leg).toEqual([
      { mix: 1, softness: 0, bendPositive: false, ...shape },
      { time: 1, mix: 0, softness: 0 },
    ]);
    expect(out.animations.anim.transform!.tc).toEqual([
      { rotateMix: 1, translateMix: 1, scaleMix: 1, shearMix: 1, ...shape },
      { time: 1, rotateMix: 0, translateMix: 0, scaleMix: 0, shearMix: 0 },
    ]);
    expect(JSON.stringify(doc)).toBe(before);
    // What 3.8 cannot hold stops the delivery instead of disappearing from it.
    const split = structuredClone(doc) as unknown as {
      animations: {
        anim: { bones: { a: Record<string, unknown> }; slots: { s: Record<string, unknown> } };
      };
      transform: Record<string, unknown>[];
    };
    split.animations.anim.bones.a.translatex = [{ value: 1 }];
    split.animations.anim.slots.s.alpha = [{ value: 1 }];
    split.transform[0]!.mixY = 0.9;
    expect(() => forEditorVersion(split, "3.8")).toThrow(
      /SPINE_38_UNSUPPORTED.*bone translatex.*slot alpha|separate x and y mixes/,
    );
  });

  it("lays a 4.0 document out for a newer editor's import (ADR-046)", () => {
    const keys = [{ vertices: [1, 2] }, { time: 0.5, offset: 2, vertices: [3] }];
    const doc = {
      skeleton: { spine: "4.0.64", images: "./images/" },
      bones: [{ name: "root" }, { name: "head", parent: "root", transform: "noScaleOrReflection" }],
      animations: {
        idle: {
          bones: { head: { rotate: [{ value: 5 }] } },
          deform: { default: { Body: { body: keys }, Tail: { tail: keys } } },
        },
        still: {},
      },
    };
    const before = JSON.stringify(doc);
    expect(forEditorVersion(doc, "4.0.64")).toBe(doc);
    const v42 = forEditorVersion(doc, "4.2") as unknown as {
      skeleton: { spine: string; images: string };
      bones: Record<string, unknown>[];
      animations: Record<string, Record<string, unknown>>;
    };
    expect(v42.skeleton).toEqual({ spine: "4.2.0", images: "./images/" });
    expect(v42.bones[1]).toEqual({ name: "head", parent: "root", inherit: "noScaleOrReflection" });
    expect(v42.animations.idle).toEqual({
      bones: { head: { rotate: [{ value: 5 }] } },
      attachments: {
        default: { Body: { body: { deform: keys } }, Tail: { tail: { deform: keys } } },
      },
    });
    expect(v42.animations.still).toEqual({});
    // 4.1 moves the deform keys but still reads `transform`.
    const v41 = forEditorVersion(doc, "4.1.24") as unknown as typeof v42;
    expect(v41.skeleton.spine).toBe("4.1.24");
    expect(v41.bones[1]!.transform).toBe("noScaleOrReflection");
    expect(v41.animations.idle!.deform).toBeUndefined();
    expect(JSON.stringify(doc)).toBe(before);
  });

  it.skipIf(process.platform === "win32")(
    "passes the chosen version to the editor's command line",
    async () => {
      const ws = await fixtureWorkspace();
      const plan = join(ws, "plan.json");
      await buildCharacterFiles(plan, join(ws, "build"));
      const delivery = join(ws, "Character", "AutoSpine");
      const result = await deliverFiles(plan, join(ws, "build"), delivery, undefined, {
        name: "Fixture_Idle",
        spine: await fakeSpine(ws),
        spineVersion: "4.2.43",
        video: false,
      });
      expect(result.spineVersion).toBe("4.2.43");
      const project = JSON.parse(await readFile(result.spine!, "utf8")) as { args: string[] };
      expect(project.args.slice(0, 2)).toEqual(["-u", "4.2.43"]);
    },
    120_000,
  );

  it("delivers only the images the project draws, and tells an edited project by its hash", async () => {
    const ws = await fixtureWorkspace();
    const plan = join(ws, "plan.json");
    const build = join(ws, "build");
    await buildCharacterFiles(plan, build);
    // An artist's image folder holds more than the project draws.
    await writeFile(join(ws, "images", "Thumbs.db"), "thumbnails");
    await writeFile(join(ws, "images", "art.zip"), "archive");
    await writeFile(join(ws, "images", "FX_Glow.png"), "another skeleton's image");
    await mkdir(join(ws, "images", "設定"));
    await writeFile(join(ws, "images", "設定", "note.txt"), "settings");
    const delivery = await mkdtemp(join(tmpdir(), "autospine-delivery-"));
    const deliver = (opts: { replace?: boolean; force?: boolean } = {}) =>
      deliverFiles(plan, build, delivery, undefined, { video: false, ...opts });

    const first = await deliver();
    const drawn = (await readdir(join(build, "images"))).sort();
    expect(drawn).toHaveLength(7);
    expect((await readdir(join(delivery, "images"))).sort()).toEqual(drawn);
    expect(first).toMatchObject({ imageFiles: 7, strayImages: [] });
    // Spine's project where the editor is installed, otherwise the JSON for Import Data.
    const project = (first.spine ?? first.json)!;
    const sha = createHash("sha256")
      .update(await readFile(project))
      .digest("hex");
    // The record is kept in _work/, out of the requester's way (a dot file shows in Explorer).
    const record = JSON.parse(
      await readFile(join(delivery, "_work", "delivery.json"), "utf8"),
    ) as Record<string, { sha256: string; engineVersion: string }>;
    expect(record[basename(project)]).toMatchObject({
      sha256: sha,
      engineVersion: AUTOSPINE_VERSION,
    });

    // Unchanged, the project is replaced however recently it was saved; an image left over from
    // an earlier delivery is reported and kept.
    await writeFile(join(delivery, "images", "old.png"), "left over");
    const second = await deliver({ replace: true });
    expect(second.strayImages).toEqual(["old.png"]);
    expect(await readdir(join(delivery, "images"))).toContain("old.png");

    // Changed seconds after the delivery (edited in Spine): not replaced without --force.
    const edited = (second.spine ?? second.json)!;
    await appendFile(edited, " ");
    await expect(deliver({ replace: true })).rejects.toThrow("CLI_DELIVER_EDITED");
    await expect(readFile(edited, "utf8")).resolves.toMatch(/ $/);
    const forced = await deliver({ replace: true, force: true });
    expect((await readdir(forced.replaced!)).sort()).toEqual([basename(edited)]);

    // A delivery from 0.5.7 or 0.5.8 kept the record beside the project: still read, then moved.
    await rename(
      join(delivery, "_work", "delivery.json"),
      join(delivery, ".autospine-delivery.json"),
    );
    await appendFile((forced.spine ?? forced.json)!, " ");
    await expect(deliver({ replace: true })).rejects.toThrow("CLI_DELIVER_EDITED");
    await deliver({ replace: true, force: true });
    expect(await readdir(delivery)).not.toContain(".autospine-delivery.json");
    expect(await readdir(join(delivery, "_work"))).toEqual(["delivery.json"]);
    // A missing image stops the delivery before anything is written.
    await expect(
      deliverFiles(plan, build, await mkdtemp(join(tmpdir(), "autospine-delivery-")), undefined, {
        video: false,
        images: join(ws, "build"),
      }),
    ).rejects.toThrow("CLI_DELIVER_IMAGES");
  }, 180_000);

  it("lays out _work/ and reports anything else left at the top of the project folder", async () => {
    const ws = await fixtureWorkspace();
    const project = join(ws, "Character", "AutoSpine");
    const layout = await initProjectFolder(project);
    expect((await readdir(layout.work)).sort()).toEqual(
      ["builds", "checks", "input", "notes", "plans"].sort(),
    );
    // Idempotent: a second call keeps what is there.
    await writeFile(join(layout.work, "notes", "note.txt"), "kept");
    await initProjectFolder(project);
    expect(await readdir(join(layout.work, "notes"))).toEqual(["note.txt"]);

    const plan = join(ws, "plan.json");
    await buildCharacterFiles(plan, join(layout.work, "builds", "build-01"));
    await writeFile(join(project, "make-plan.mjs"), "// a helper script left behind");
    await writeFile(join(project, "plan-3.json"), "{}");
    const result = await deliverFiles(
      plan,
      join(layout.work, "builds", "build-01"),
      project,
      undefined,
      { video: false },
    );
    // Only files that are neither projects, videos nor art are reported; nothing is moved.
    expect(result.stray).toEqual(["make-plan.mjs"]);
    expect(await readdir(project)).toContain("make-plan.mjs");
    // The delivery record joins the work folder; nothing new at the top level.
    expect((await readdir(layout.work)).sort()).toEqual(
      ["builds", "checks", "delivery.json", "input", "notes", "plans"].sort(),
    );
    expect((await readdir(project)).filter((f) => f.startsWith("."))).toEqual([]);
  }, 120_000);
});
