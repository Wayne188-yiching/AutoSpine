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
import { buildCharacterFiles, deliverFiles, initProjectFolder } from "@autospine/cli/character";
import { AUTOSPINE_VERSION } from "@autospine/cli/version";
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
