import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildCharacter, rigCharacter, type DraftFigure } from "@autospine/character";
import { draftMotion } from "@autospine/character";
import { draftMotionFiles } from "@autospine/cli/character";
import { AutoSpineMcpServer, mcpTools } from "@autospine/mcp";
import { loopRecipe, oneShotTemplate } from "@autospine/motion";
import type { CharacterPlan } from "@autospine/schemas";
import { fixtureLayout, fixturePlan, fixtureWorkspace } from "./character-fixture.js";

type Plan = CharacterPlan;
const read = async (f: string) => JSON.parse(await readFile(f, "utf8")) as Plan;
const anim = (p: Plan, name: string) => p.motion.animations.find((a) => a.name === name)!;

describe("motion drafts from the measured priors (ADR-048)", () => {
  it("is an MCP tool that writes a new workspace-local plan", async () => {
    const ws = await fixtureWorkspace();
    const tool = mcpTools.find((t) => t.name === "autospine_motion_draft")!;
    expect(tool.annotations.readOnlyHint).toBe(false);
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
    const reply = (await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "autospine_motion_draft",
        arguments: {
          planPath: "plan.json",
          outputPath: "plans/win.json",
          animation: "Win",
          frames: 30,
        },
      },
    })) as { result?: { isError?: boolean; structuredContent?: Record<string, unknown> } };
    expect(reply.result?.isError).toBeFalsy();
    expect(reply.result?.structuredContent).toMatchObject({
      output: join("plans", "win.json"),
      kind: "jump",
      frames: 30,
      loop: false,
    });
    expect(anim(await read(join(ws, "plans", "win.json")), "Win").frames).toBe(30);
  });

  it("drafts an idle: a breath on the main bone, head follow, strand waves, arm swing", async () => {
    const ws = await fixtureWorkspace();
    const out = join(ws, "plans", "idle.json");
    const r = await draftMotionFiles(join(ws, "plan.json"), out, { animation: "IDLE" });
    expect(r).toMatchObject({ kind: "idle", subject: "character", loop: true, frames: 80 });
    const plan = await read(out);
    // The new file sits in another folder: its source paths point back at the art.
    expect(plan.source).toEqual({ imagesOnly: "../imagesOnly.json", images: "../images" });
    const own = anim(plan, "IDLE").motion!;
    const recipe = loopRecipe("idle", r.unit);
    expect(own.main).toMatchObject({ bone: "hips", shape: "breath", depth: recipe.depth });
    expect(own.cycle).toBe(80);
    expect(own.follow).toEqual([
      { id: "IDLE_head", bone: "head", channel: "translate", gain: 0.7, lag: 8 },
    ]);
    expect(own.waves).toEqual([
      expect.objectContaining({
        chain: "Hair",
        rootGain: +(recipe.strandAmplitude / recipe.depth).toFixed(2),
      }),
    ]);
    expect(own.cycles).toEqual([
      expect.objectContaining({ bone: "arm_r", amplitude: 2, period: 80 }),
    ]);
    expect(own.beats).toEqual([]);
    // The plan's per-cycle depth scales went with its old cycles.
    expect(anim(plan, "IDLE").cycleScale).toBeUndefined();
    expect(r.notes).toContain("dropped IDLE's cycleScale");
    // It builds; the other plan blocks are untouched.
    expect(plan.motion.main).toEqual(fixturePlan().motion.main);
    expect(() => buildCharacter(plan, fixtureLayout())).not.toThrow();
  });

  it("drafts a one-shot on a move bone added at the feet, and redrafts it in place", async () => {
    const ws = await fixtureWorkspace();
    const first = join(ws, "win.json");
    const r = await draftMotionFiles(join(ws, "plan.json"), first, { animation: "Win" });
    expect(r).toMatchObject({ kind: "jump", loop: false, frames: 45 });
    expect(r.notes[0]).toMatch(/45 frames \(1.5 s\) by default/);
    const plan = await read(first);
    const move = plan.bones.find((b) => "id" in b && b.id === "move") as {
      parent: string;
      at: unknown;
    };
    expect(move.parent).toBe("root");
    // Everything that hung from the root now hangs from move.
    expect(
      plan.bones.filter((b) => "id" in b && b.parent === "root").map((b) => "id" in b && b.id),
    ).toEqual(["move"]);
    const t = oneShotTemplate("Win", { frames: 45, unit: r.unit, subject: "character" });
    const keyed = plan.motion.keyed!.filter((c) => c.bone === "move");
    expect(keyed.map((c) => c.channel)).toEqual(["translate", "rotate"]);
    expect(keyed[0]!.keys.Win).toEqual(t.translate);
    expect(anim(plan, "Win")).toMatchObject({ frames: 45, loop: false });
    const built = buildCharacter(plan, fixtureLayout());
    const doc = built.document as unknown as {
      animations: Record<string, { bones: Record<string, Record<string, unknown[]>> }>;
    };
    expect(Object.keys(doc.animations.Win!.bones.move!)).toEqual(
      expect.arrayContaining(["translate", "rotate"]),
    );

    // Again on the drafted plan, longer: same controls, the old keys taken out, one move bone.
    const second = join(ws, "win2.json");
    const again = await draftMotionFiles(first, second, { animation: "Win", frames: 60 });
    const redrafted = await read(second);
    expect(redrafted.bones.filter((b) => "id" in b && b.id === "move")).toHaveLength(1);
    expect(redrafted.motion.keyed!.filter((c) => c.bone === "move")).toHaveLength(2);
    expect(again.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/took Win's keys out of Win_move_translate/)]),
    );
    expect(anim(redrafted, "Win").frames).toBe(60);
    await expect(draftMotionFiles(first, second, { animation: "Win" })).rejects.toThrow(
      "CLI_OUTPUT_EXISTS",
    );
  });

  it("fades an entry in on the parts it shows, as the idle shows them", async () => {
    const ws = await fixtureWorkspace();
    const plan = fixturePlan();
    anim(plan, "IDLE").hide = ["Arm_R"];
    await writeFile(join(ws, "plan.json"), JSON.stringify(plan));
    const out = join(ws, "in.json");
    const r = await draftMotionFiles(join(ws, "plan.json"), out, { animation: "In", frames: 30 });
    expect(r.kind).toBe("entry");
    const drafted = await read(out);
    expect(anim(drafted, "In").hide).toEqual(["Arm_R"]);
    expect(r.notes).toContain("In shows the parts IDLE shows (its show and hide lists)");
    const alpha = drafted.motion.colors!.find((c) => c.id === "In_alpha")!;
    expect(alpha.slots).not.toContain("Arm_R");
    expect(alpha.slots).toContain("Body");
    expect(alpha.keys.In![0]).toMatchObject({ frame: 0 });
    expect(
      drafted.motion.keyed!.filter((c) => c.id.startsWith("In_")).map((c) => c.channel),
    ).toEqual(["translate", "scale", "rotate"]);
  });

  it("takes the kind, subject and head from the caller, and says what it could not do", () => {
    const plan = fixturePlan();
    const layout = fixtureLayout();
    const figure: DraftFigure = {
      unit: 100,
      parts: [
        { slot: "Body", box: [-20, -60, 20, 0] },
        { slot: "Head", box: [-25, -110, 25, -60] },
      ],
      chains: rigCharacter(plan, layout).rigged.chains,
    };
    // A prop loop tilts a move bone at the centre of what it shows.
    const prop = draftMotion(plan, figure, { animation: "IDLE", subject: "prop" });
    expect(prop.kind).toBe("prop");
    const moveBone = prop.plan.bones.find((b) => "id" in b && b.id === "move") as {
      at: { at: number[] };
    };
    expect(moveBone.at.at).toEqual([0, -55]);
    expect(anim(prop.plan, "IDLE").motion!.cycles).toEqual([
      expect.objectContaining({ bone: "move", channel: "rotate", amplitude: 2.25, period: 80 }),
    ]);
    // A look with no head bone given leaves the turns out and says so.
    const look = draftMotion(plan, figure, { animation: "Shy", kind: "look", frames: 40 });
    expect(look.kind).toBe("look");
    expect(look.notes).toEqual(
      expect.arrayContaining([
        "no head bone found: no head follow or look turns",
        "no `head` bone: the look's head turns were left out",
      ]),
    );
    const drafted = (p: Plan) => (p.motion.keyed ?? []).filter((c) => c.id.startsWith("Shy_"));
    expect(drafted(look.plan)).toEqual([]);
    const withHead = draftMotion(
      plan,
      { ...figure, head: "head" },
      { animation: "Shy", kind: "look", frames: 40 },
    );
    expect(drafted(withHead.plan).map((c) => [c.bone, c.channel])).toEqual([["head", "rotate"]]);
    // A walk: legs and arms in opposite phase, and a note that its prior is weak.
    const walk = draftMotion(plan, { ...figure, head: "head" }, { animation: "Walk" });
    expect(walk).toMatchObject({ kind: "walk", frames: 40, loop: true });
    expect(anim(walk.plan, "Walk").motion!.cycle).toBe(20);
    expect(walk.notes.some((n) => /one art/.test(n))).toBe(true);
    expect(() => draftMotion(plan, figure, { animation: "Bad name!" })).toThrow(/is not usable/);
  });
});
