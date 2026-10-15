import { describe, expect, it } from "vitest";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CharacterPlan } from "@autospine/schemas";
import { buildCharacter, lintCharacterPlan, mergePlans } from "@autospine/character";
import { buildCharacterFiles, mergePlanFiles } from "@autospine/cli/character";
import { drawList, loadSkeleton, pose } from "@autospine/reference";
import { fixtureLayout, fixturePlan, fixtureWorkspace } from "./character-fixture.js";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as { validation?: { id?: string } }).validation?.id ?? (e as Error).message;
  }
  return "no error";
};

/** Vertex positions of every drawn slot at a few times of one animation. */
function trace(document: unknown, animation: string): Map<string, number[]> {
  const sk = loadSkeleton(document);
  const D = sk.data.findAnimation(animation)!.duration;
  const out = new Map<string, number[]>();
  for (const f of [0, 0.2, 0.45, 0.7, 0.95]) {
    pose(sk, animation, f * D);
    for (const d of drawList(sk)) out.set(`${f}:${d.slot}`, d.verts);
  }
  return out;
}
const worst = (a: Map<string, number[]>, b: Map<string, number[]>) => {
  expect([...a.keys()].sort()).toEqual([...b.keys()].sort());
  let w = 0;
  for (const [k, v] of a) v.forEach((x, i) => (w = Math.max(w, Math.abs(x - b.get(k)![i]!))));
  return w;
};

/** A one-shot of the fixture on its own plan: a `move` bone over the root's children grows it in. */
function entryPlan(): CharacterPlan {
  const plan = clone(fixturePlan());
  plan.id = "fixture_entry";
  plan.joints.movePivot = { rule: "point", at: [0, 0] };
  plan.bones = plan.bones.map((b) =>
    "chain" in b ? b : b.parent === "root" ? { ...b, parent: "move" } : b,
  );
  plan.bones.splice(1, 0, { id: "move", parent: "root", at: "movePivot", angle: -90, length: 20 });
  plan.motion.animations = [{ name: "Extra/IN", frames: 40, loop: false }];
  plan.motion.main = {
    id: "body",
    bone: "hips",
    channel: "translate",
    shape: "breath",
    down: 20,
    depth: 2,
  };
  plan.motion.keyed = [
    {
      id: "grow",
      bone: "move",
      channel: "scale",
      rest: [1, 1],
      keys: {
        "Extra/IN": [
          { frame: 0, value: [0.3, 0.3] },
          { frame: 20, value: [1, 1], ease: "out" },
        ],
      },
    },
  ];
  plan.motion.swaps = [];
  plan.motion.colors = [];
  delete plan.motion.search;
  return plan;
}

describe("one project per character (ADR-031)", () => {
  it("builds each animation of a merged plan as its own plan built it", () => {
    const idle = clone(fixturePlan());
    const entry = entryPlan();
    expect(lintCharacterPlan(entry, fixtureLayout().parts.keys()).errors).toEqual([]);
    const { plan, notes } = mergePlans([idle, entry]);
    expect(plan.motion.animations.map((a) => a.name)).toEqual(["IDLE", "Extra/IN"]);
    expect(plan.motion.animations[1]!.motion?.main?.shape).toBe("breath");
    expect(notes.join("\n")).toMatch(/parent move \(inserted by fixture_entry\)/);
    expect(lintCharacterPlan(plan, fixtureLayout().parts.keys()).errors).toEqual([]);

    const merged = buildCharacter(plan, fixtureLayout()).document;
    // The loop is unchanged by the inserted parent: translate keys are authored in world space.
    expect(
      worst(trace(merged, "IDLE"), trace(buildCharacter(idle, fixtureLayout()).document, "IDLE")),
    ).toBeLessThan(1e-3);
    expect(
      worst(
        trace(merged, "Extra/IN"),
        trace(buildCharacter(entry, fixtureLayout()).document, "Extra/IN"),
      ),
    ).toBeLessThan(1e-3);
  });

  it("lists conflicts instead of guessing", () => {
    const other = clone(fixturePlan());
    other.id = "fixture_other";
    other.motion.animations = [{ name: "OTHER", frames: 80 }];
    other.regions = { ...other.regions, Eyes: "head" };
    other.joints.neck = { rule: "point", at: [1, 2] };
    const message = code(() => mergePlans([fixturePlan(), other]));
    expect(message).toBe("PLAN_MERGE");
    try {
      mergePlans([fixturePlan(), other]);
    } catch (e) {
      expect((e as Error).message).toMatch(/joint neck/);
      expect((e as Error).message).toMatch(/region Eyes/);
    }
    expect(code(() => mergePlans([fixturePlan(), fixturePlan()]))).toBe("PLAN_MERGE");
  });

  it("merges plan files into one build with every animation", async () => {
    const ws = await fixtureWorkspace();
    await writeFile(join(ws, "entry.json"), JSON.stringify(entryPlan()));
    const merged = await mergePlanFiles(join(ws, "all.json"), [
      join(ws, "plan.json"),
      join(ws, "entry.json"),
    ]);
    expect(merged.animations).toEqual(["IDLE", "Extra/IN"]);
    const plan = JSON.parse(await readFile(join(ws, "all.json"), "utf8")) as CharacterPlan;
    expect(plan.source).toEqual({ imagesOnly: "imagesOnly.json", images: "images" });
    await buildCharacterFiles(join(ws, "all.json"), join(ws, "build"));
    const files = await readdir(join(ws, "build"));
    // A Spine folder in an animation name stays out of the file names.
    expect(files).toEqual(
      expect.arrayContaining(["keypose-IDLE.json", "keypose-Extra_IN.json", "HANDOVER.md"]),
    );
    const doc = JSON.parse(await readFile(join(ws, "build", `${plan.id}.json`), "utf8")) as {
      animations: Record<string, unknown>;
    };
    expect(Object.keys(doc.animations).sort()).toEqual(["Extra/IN", "IDLE"]);
    const notes = await readFile(join(ws, "build", "HANDOVER.md"), "utf8");
    expect(notes).toContain("Extra/IN");
    expect(notes).toContain("單次");
    // The one-shot's `move` bone carries no image and is keyed: a control bone (red).
    expect(notes).toMatch(/控制骨（紅）.*`move`/);
  });
});
