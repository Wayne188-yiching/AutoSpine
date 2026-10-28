import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildCharacter } from "@autospine/character";
import { applyRigMotion, loadSkeleton, pose, prepareRig } from "@autospine/reference";
import { fixtureLayout, fixturePlan, fixtureWorkspace } from "./character-fixture.js";

const original = () =>
  buildCharacter(fixturePlan(), fixtureLayout()).document as Record<string, unknown>;

describe("new motion on an explicitly supplied artist binding", () => {
  it("prepares and applies new motion through the CLI without overwriting files", async () => {
    const dir = await fixtureWorkspace(),
      source = join(dir, "artist.json"),
      rig = join(dir, "rig.json"),
      motion = join(dir, "motion.json"),
      output = join(dir, "new.json"),
      before = JSON.stringify(original());
    await writeFile(source, before);
    await writeFile(
      motion,
      JSON.stringify({ Fresh: { bones: { head: { rotate: [{ value: 2 }] } } } }),
    );
    const run = (...args: string[]) =>
      execFileSync(process.execPath, [resolve("packages/cli/dist/index.js"), ...args], {
        encoding: "utf8",
        stdio: "pipe",
        windowsHide: true,
      });
    expect(JSON.parse(run("prepare-rig", source, rig)).animations).toBe(0);
    expect(JSON.parse(run("apply-rig-motion", rig, motion, output)).bindingUnchanged).toBe(true);
    expect(Object.keys(JSON.parse(await readFile(output, "utf8")).animations)).toEqual(["Fresh"]);
    expect(() => run("apply-rig-motion", rig, motion, output)).toThrow("EEXIST");
    expect(await readFile(source, "utf8")).toBe(before);
  });
  it("retains all static rig fields without reading source animation or event contents", () => {
    const source = original();
    Object.defineProperty(source, "animations", {
      get: () => {
        throw new Error("Source animation read");
      },
    });
    Object.defineProperty(source, "events", {
      get: () => {
        throw new Error("Source event read");
      },
    });
    const clean = prepareRig(source);
    for (const field of ["bones", "slots", "skins", "ik", "transform", "path"])
      expect(clean[field]).toEqual(source[field]);
    expect(clean.animations).toEqual({});
    expect(clean).not.toHaveProperty("events");
    expect(clean.skeleton).toMatchObject({ images: "./images/" });
  });

  it("plays newly authored keys while leaving the input and binding unchanged", () => {
    const rig = prepareRig(original()),
      before = JSON.stringify(rig);
    const result = applyRigMotion(rig, {
      Fresh: {
        bones: {
          head: {
            rotate: [
              { time: 0, value: 0 },
              { time: 1, value: 10 },
            ],
          },
        },
      },
    });
    expect(prepareRig(result)).toEqual(rig);
    expect(JSON.stringify(rig)).toBe(before);
    const sk = loadSkeleton(result),
      head = sk.skeleton.findBone("head")!;
    pose(sk, "Fresh", 0);
    const initialRotation = head.getWorldRotationX();
    pose(sk, "Fresh", 0.5);
    expect(head.getWorldRotationX() - initialRotation).toBeCloseTo(5);
    expect(Object.keys(result.animations as object)).toEqual(["Fresh"]);
  });

  it("refuses original animations, unknown controls and attachments, and unbound events", () => {
    expect(() => applyRigMotion(original(), { Fresh: {} })).toThrow("RIG_ANIMATIONS");
    const rig = prepareRig(original());
    expect(() => applyRigMotion(rig, { Fresh: { bones: { missing: {} } } })).toThrow(
      "unknown bones owner",
    );
    expect(() =>
      applyRigMotion(rig, { Fresh: { slots: { Eyes: { attachment: [{ name: "missing" }] } } } }),
    ).toThrow("unknown attachment");
    expect(() => applyRigMotion(rig, { Fresh: { deform: { missing: {} } } })).toThrow(
      "unknown deform skin",
    );
    expect(() => applyRigMotion(rig, { Fresh: { events: [] } })).toThrow(
      "unsupported timeline events",
    );
  });
});
