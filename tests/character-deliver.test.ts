import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCharacterFiles, deliverFiles, initProjectFolder } from "@autospine/cli/character";
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
      const expected = ["Fixture_Idle.spine", "images", ...(video ? ["Fixture_Idle.mp4"] : [])];
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
      // The old project and video move away; images/ stays for the new project.
      const replacedFiles = expected.filter((f) => f !== "images");
      expect((await readdir(second.replaced!)).sort()).toEqual(replacedFiles.sort());

      if (video) {
        // A project saved after its video was written was edited in Spine: not replaced silently.
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
      expect((await readdir(delivery)).sort()).toEqual(["fixture_character.json", "images"]);
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
  }, 120_000);
});
