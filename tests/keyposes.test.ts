import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { KeyposeSpecSchema, type AnimationSpec, type KeyposeSpec } from "@autospine/schemas";
import {
  buildKeyposeAnimation,
  keyFraction,
  sampleAnimation,
  validateLoop,
} from "@autospine/motion";
import { evaluateRig, rigFromWorldFrames } from "@autospine/rig";
import { compileCharacterSpine40 } from "@autospine/spine";

const rig = rigFromWorldFrames("kp", "Keypose rig", [
  { id: "root", name: "root", length: 0, world: [1, 0, 0, 1, 0, 0] },
  { id: "body", name: "body", parentId: "root", length: 100, world: [1, 0, 0, 1, 0, -100] },
  { id: "head", name: "head", parentId: "body", length: 50, world: [0, 1, -1, 0, 0, -200] },
  { id: "face", name: "face", parentId: "head", length: 0, world: [0, 1, -1, 0, 0, -250] },
  { id: "eye", name: "eye", parentId: "face", length: 0, world: [0, 1, -1, 0, 0, -250] },
  { id: "tail1", name: "tail1", parentId: "body", length: 30, world: [1, 0, 0, 1, 20, -100] },
  { id: "tail2", name: "tail2", parentId: "tail1", length: 30, world: [1, 0, 0, 1, 50, -100] },
  { id: "tail3", name: "tail3", parentId: "tail2", length: 30, world: [1, 0, 0, 1, 80, -100] },
  { id: "handL", name: "handL", parentId: "root", length: 10, world: [1, 0, 0, 1, -60, -150] },
  { id: "handR", name: "handR", parentId: "root", length: 10, world: [1, 0, 0, 1, 60, -150] },
]);
function spec(patch: Partial<KeyposeSpec>): KeyposeSpec {
  return {
    schemaVersion: "0.1",
    kind: "keypose-spec",
    id: "kp-anim",
    name: "kp",
    rigId: "kp",
    fps: 30,
    frames: 60,
    loop: true,
    controls: [],
    beats: [],
    rules: [],
    ...patch,
  };
}
const rot = (a: AnimationSpec, bone: string, frame: number) =>
  sampleAnimation(a, rig, frame / 30).rotations[bone]!;
const tr = (a: AnimationSpec, bone: string, frame: number) =>
  sampleAnimation(a, rig, frame / 30).translations[bone]!;
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { validation?: { issues: { code: string }[] } }).validation?.issues[0]?.code;
  }
  return "no error";
};
const tailBeats = spec({
  controls: [
    { id: "t1", boneId: "tail1", channel: "rotate" },
    { id: "t2", boneId: "tail2", channel: "rotate" },
    { id: "t3", boneId: "tail3", channel: "rotate" },
  ],
  beats: [
    { frame: 0, poses: { t1: 0 } },
    { frame: 12, ease: "out", poses: { t1: 10 } },
    { frame: 30, poses: { t1: -6 } },
    { frame: 45, ease: "hold", poses: { t1: 2 } },
  ],
  rules: [
    { rule: "follow", control: "t2", source: "t1", lag: 4, gain: 1.5 },
    { rule: "follow", control: "t3", source: "t2", lag: 4, gain: 1.4 },
  ],
});

describe("pose-table motion grammar", () => {
  it("compiles beats into sparse curved keys on the frame grid", () => {
    const a = buildKeyposeAnimation(
      rig,
      spec({
        loop: false,
        controls: [{ id: "body", boneId: "body", channel: "translate", unit: 10 }],
        beats: [
          { frame: 0, poses: { body: [0, 0] } },
          { frame: 12, ease: "out", poses: { body: [1, -2] } },
          { frame: 30, ease: "hold", poses: { body: [0, -1] } },
          { frame: 48, poses: { body: [0, 0] } },
        ],
      }),
    );
    const keys = a.translationTimelines![0]!.keys;
    expect(keys.map((k) => k.time)).toEqual([0, 0.4, 1, 1.6, 2]);
    const near = (x: number, y: number) => [expect.closeTo(x, 9), expect.closeTo(y, 9)];
    expect(keys.map((k) => [k.x, k.y])).toEqual([
      near(0, 0),
      near(10, -20),
      near(0, -10),
      near(0, 0),
      near(0, 0),
    ]);
    expect(keys[0]!.curve).toEqual({ type: "bezier", x1: 0.12, y1: 0.6, x2: 0.45, y2: 1 });
    expect(keys[1]!.curve).toEqual({ type: "stepped" }); // beat 30 arrives by a cut
    expect(keys[2]!.curve?.type).toBe("bezier"); // default "ease"
    expect(keys[3]!.curve).toBeUndefined(); // final hold to the end
    expect(tr(a, "body", 6)[0]).toBeCloseTo(10 * keyFraction(keys[0]!.curve, 0.5), 12);
    expect(tr(a, "body", 29)).toEqual(near(10, -20));
    expect(a.duration).toBe(2);
  });

  it("wraps a loop through its seam with the first beat's arrival ease", () => {
    const a = buildKeyposeAnimation(
      rig,
      spec({
        controls: [{ id: "t1", boneId: "tail1", channel: "rotate" }],
        beats: [
          { frame: 10, ease: "out", poses: { t1: 8 } },
          { frame: 40, poses: { t1: -4 } },
        ],
      }),
    );
    expect(validateLoop(a, rig).status).toBe("passed");
    // Closing segment 40 -> 70 (= frame 10 next cycle) uses beat 10's "out" ease, split exactly at 60.
    const out = { type: "bezier", x1: 0.12, y1: 0.6, x2: 0.45, y2: 1 } as const;
    for (const f of [45, 50, 59, 61 - 60, 5, 9])
      expect(rot(a, "tail1", f)).toBeCloseTo(
        -4 + 12 * keyFraction(out, ((f - 40 + 60) % 60) / 30),
        9,
      );
    expect(a.rotationTimelines![0]!.keys.length).toBeLessThanOrEqual(5);
  });

  it("follows a source exactly, delayed and scaled, across the loop seam", () => {
    const a = buildKeyposeAnimation(rig, tailBeats);
    for (let f = 0; f <= 60; f += 0.5) {
      expect(rot(a, "tail2", f)).toBeCloseTo(1.5 * rot(a, "tail1", (f - 4 + 60) % 60), 9);
      expect(rot(a, "tail3", f)).toBeCloseTo(1.4 * rot(a, "tail2", (f - 4 + 60) % 60), 9);
    }
    expect(validateLoop(a, rig).status).toBe("passed");
    const peak = (bone: string) => {
      let best = 0;
      for (let f = 0; f < 60; f++) if (rot(a, bone, f) > rot(a, bone, best)) best = f;
      return best;
    };
    expect([peak("tail1"), peak("tail2"), peak("tail3")]).toEqual([12, 16, 20]);
    expect(Value.Check(KeyposeSpecSchema, tailBeats)).toBe(true);
    const wrapped = structuredClone(tailBeats);
    (wrapped.rules[0] as { lag: number }).lag = 64; // one full loop plus 4 frames
    expect(rot(buildKeyposeAnimation(rig, wrapped), "tail2", 30)).toBeCloseTo(
      rot(a, "tail2", 30),
      9,
    );
    expect(JSON.stringify(buildKeyposeAnimation(rig, tailBeats))).toBe(JSON.stringify(a));
  });

  it("holds the start for a positive lag and maps components and mirrored sides", () => {
    const a = buildKeyposeAnimation(
      rig,
      spec({
        loop: false,
        controls: [
          { id: "body", boneId: "body", channel: "translate" },
          { id: "tail", boneId: "tail1", channel: "rotate" },
          { id: "handL", boneId: "handL", channel: "translate" },
          { id: "handR", boneId: "handR", channel: "translate" },
        ],
        beats: [
          { frame: 0, poses: { body: [0, 0], handL: [0, 0] } },
          { frame: 20, poses: { body: [4, -10], handL: [6, -3] } },
          { frame: 40, poses: { body: [0, 0], handL: [0, 0] } },
        ],
        rules: [
          { rule: "follow", control: "tail", source: "body", component: "y", lag: 3, gain: 2 },
          { rule: "follow", control: "handR", source: "handL", lag: 2, gain: [-0.8, 0.8] },
        ],
      }),
    );
    expect(rot(a, "tail1", 2)).toBe(0);
    for (const f of [5, 13, 23, 30, 45, 60]) {
      expect(rot(a, "tail1", f)).toBeCloseTo(2 * tr(a, "body", Math.max(0, f - 3))[1]!, 9);
      const l = tr(a, "handL", Math.max(0, f - 2));
      expect(tr(a, "handR", f)).toEqual([
        expect.closeTo(-0.8 * l[0]!, 9),
        expect.closeTo(0.8 * l[1]!, 9),
      ]);
    }
  });

  it("makes eyes jump to the next pose within the move window, then hold", () => {
    const face = (lead: number) =>
      buildKeyposeAnimation(
        rig,
        spec({
          controls: [
            { id: "face", boneId: "face", channel: "translate", space: "parent" },
            { id: "eye", boneId: "eye", channel: "translate", space: "parent" },
          ],
          beats: [
            { frame: 0, poses: { face: [0, 0] } },
            { frame: 20, poses: { face: [10, 0] } },
            { frame: 40, poses: { face: [-10, 4] } },
          ],
          rules: [{ rule: "saccade", control: "eye", source: "face", gain: 0.5, lead }],
        }),
      );
    const a = face(0);
    for (const f of [2, 10, 19]) expect(tr(a, "eye", f)).toEqual([5, 0]);
    expect(tr(a, "eye", 1)[0]).toBeGreaterThan(2.5); // fast start
    for (const f of [22, 39]) expect(tr(a, "eye", f)).toEqual([-5, 2]);
    expect(tr(a, "face", 10)[0]).toBeLessThan(10); // the head is still travelling
    const led = face(3);
    expect(tr(led, "eye", 19)).toEqual([-5, 2]); // leads the head's next move by 3 frames
    expect(validateLoop(led, rig).status).toBe("passed");
  });

  it("releases a dragged pose, overshoots and decays to rest", () => {
    const a = buildKeyposeAnimation(
      rig,
      spec({
        loop: false,
        frames: 40,
        controls: [{ id: "hand", boneId: "handL", channel: "rotate" }],
        rules: [
          {
            rule: "settle",
            control: "hand",
            from: -10,
            start: 4,
            travel: 6,
            overshoot: 0.5,
            damping: 0.4,
            period: 5,
          },
        ],
      }),
    );
    const keys = a.rotationTimelines![0]!.keys;
    // Extremes decay by 0.4 until below 10% of the first overshoot.
    expect(keys.map((k) => Math.round(k.time * 30))).toEqual([0, 4, 10, 15, 20, 25, 40]);
    expect(keys.map((k) => +k.degrees.toFixed(4))).toEqual([-10, -10, 5, -2, 0.8, 0, 0]);
    expect(rot(a, "handL", 3)).toBe(-10); // drag hold before release
    expect(
      code(() =>
        buildKeyposeAnimation(
          rig,
          spec({
            controls: [{ id: "hand", boneId: "handL", channel: "rotate" }],
            rules: [
              {
                rule: "settle",
                control: "hand",
                from: 1,
                start: 0,
                travel: 2,
                overshoot: 0,
                damping: 0,
                period: 2,
              },
            ],
          }),
        ),
      ),
    ).toBe("KEYPOSE_RULE");
  });

  it("keys a cycle only at its extremes", () => {
    const build = (period: number) =>
      buildKeyposeAnimation(
        rig,
        spec({
          controls: [{ id: "t1", boneId: "tail1", channel: "rotate" }],
          rules: [{ rule: "cycle", control: "t1", amplitude: 6, period }],
        }),
      );
    const a = build(20),
      keys = a.rotationTimelines![0]!.keys;
    expect(keys.map((k) => Math.round(k.time * 30))).toEqual([0, 5, 15, 25, 35, 45, 55, 60]);
    expect(keys.slice(1, -1).map((k) => k.degrees)).toEqual([6, -6, 6, -6, 6, -6]);
    expect(keys[0]!.degrees).toBeCloseTo(0, 12);
    expect(validateLoop(a, rig).status).toBe("passed");
    expect(code(() => build(16))).toBe("KEYPOSE_RULE");
  });

  it("converts world-space translation through the rotated parent at setup", () => {
    const a = buildKeyposeAnimation(
      rig,
      spec({
        loop: false,
        controls: [{ id: "face", boneId: "face", channel: "translate", unit: 10 }],
        beats: [{ frame: 0, poses: { face: [1, -0.5] } }],
      }),
    );
    const offset = sampleAnimation(a, rig, 0).translations.face!;
    const before = evaluateRig(rig).get("face")!,
      after = evaluateRig(rig, {}, { translations: { face: offset } }).get("face")!;
    expect(after[4] - before[4]).toBeCloseTo(10, 9);
    expect(after[5] - before[5]).toBeCloseTo(-5, 9);
  });

  it("compiles through the character adapter as sparse curved keys", () => {
    const a = buildKeyposeAnimation(rig, tailBeats);
    const doc = compileCharacterSpine40({
      rig,
      imagesPath: "./images/",
      slots: [
        {
          name: "body",
          boneId: "body",
          attachments: [
            {
              kind: "region",
              name: "body",
              path: "body",
              boneId: "body",
              width: 10,
              height: 10,
              world: [1, 0, 0, 1, 0, -100],
            },
          ],
        },
      ],
      animations: [a],
    }) as unknown as {
      animations: Record<string, { bones: Record<string, { rotate: { curve?: unknown }[] }> }>;
    };
    const tail3 = doc.animations.kp!.bones.tail3!.rotate;
    expect(tail3.length).toBeLessThan(12);
    expect(tail3.some((k) => Array.isArray(k.curve))).toBe(true);
  });

  it("rejects ambiguous or inconsistent pose tables with stage codes", () => {
    const one = { id: "t1", boneId: "tail1", channel: "rotate" } as const;
    const cases: [Partial<KeyposeSpec>, string][] = [
      [
        { rigId: "other", controls: [one], beats: [{ frame: 0, poses: { t1: 0 } }] },
        "KEYPOSE_REFERENCE",
      ],
      [{ controls: [one, one], beats: [{ frame: 0, poses: { t1: 0 } }] }, "KEYPOSE_CONTROL"],
      [
        { controls: [{ ...one, id: "t2" }, one], beats: [{ frame: 0, poses: { t1: 0, t2: 0 } }] },
        "KEYPOSE_CONTROL",
      ],
      [
        {
          controls: [{ ...one, unit: 2, channel: "scale" }],
          beats: [{ frame: 0, poses: { t1: [1, 1] } }],
        },
        "KEYPOSE_CONTROL",
      ],
      [
        { controls: [{ ...one, space: "world" }], beats: [{ frame: 0, poses: { t1: 0 } }] },
        "KEYPOSE_CONTROL",
      ],
      [{ controls: [one] }, "KEYPOSE_DRIVER"],
      [{ controls: [one], beats: [{ frame: 0, poses: { t1: [0, 0] } }] }, "KEYPOSE_VALUE"],
      [{ controls: [one], beats: [{ frame: 60, poses: { t1: 0 } }] }, "KEYPOSE_BEATS"],
      [
        {
          controls: [one],
          beats: [
            { frame: 5, poses: { t1: 0 } },
            { frame: 5, poses: { t1: 1 } },
          ],
        },
        "KEYPOSE_BEATS",
      ],
      [
        {
          controls: [one],
          beats: [{ frame: 0, poses: { t1: 0 } }],
          rules: [{ rule: "cycle", control: "t1", amplitude: 1, period: 20 }],
        },
        "KEYPOSE_DRIVER",
      ],
      [
        {
          controls: [one],
          rules: [{ rule: "follow", control: "t1", source: "nope", lag: 0, gain: 1 }],
        },
        "KEYPOSE_REFERENCE",
      ],
      [
        {
          controls: [one, { ...one, id: "t2", boneId: "tail2" }],
          rules: [
            { rule: "follow", control: "t1", source: "t2", lag: 1, gain: 1 },
            { rule: "follow", control: "t2", source: "t1", lag: 1, gain: 1 },
          ],
        },
        "KEYPOSE_CYCLE",
      ],
      [
        {
          controls: [one, { id: "b", boneId: "body", channel: "translate" }],
          beats: [{ frame: 0, poses: { b: [0, 0] } }],
          rules: [{ rule: "follow", control: "t1", source: "b", lag: 0, gain: 1 }],
        },
        "KEYPOSE_RULE",
      ],
      [{ controls: [one], beats: [{ frame: 0, poses: { t1: 0 } }], fps: 0 }, "KEYPOSE_INPUT"],
    ];
    for (const [patch, expected] of cases)
      expect(code(() => buildKeyposeAnimation(rig, spec(patch)))).toBe(expected);
    // An invalid spec names the first offending path.
    expect(() =>
      buildKeyposeAnimation(
        rig,
        spec({ controls: [one], beats: [{ frame: 0, poses: { t1: 0 } }], fps: 0 }),
      ),
    ).toThrow(/Invalid KeyposeSpec at \/fps/);
  });
});
