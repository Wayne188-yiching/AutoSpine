import type { CharacterPlan, RigSpec } from "@autospine/schemas";
import { failStage } from "@autospine/rig";
import { domeFoldLimit, measureDomeField, type DomeField } from "@autospine/weights";
import { angleOf, dist, strandJoints, type Vec } from "./geometry.js";
import { JointSolver, PartIndex } from "./joints.js";

type Bone = RigSpec["bones"][number];
export interface WorldFrame {
  /** World origin. */
  o: Vec;
  /** World angle, IR degrees (unrounded, as planned). */
  a: number;
}
export interface PlannedRig {
  rig: RigSpec;
  world: Map<string, WorldFrame>;
  /** Chain bone ids per strand part. */
  chains: Record<string, string[]>;
  joints: Record<string, Vec>;
  dome?: { field: DomeField; foldLimit: [number, number] };
  evidence: Record<string, unknown>;
}

/**
 * Places the plan's bones. Each bone is stored relative to its parent's planned world frame
 * (origin and angle), so the setup pose reproduces the planned joints exactly.
 */
export function planRig(plan: CharacterPlan, index: PartIndex): PlannedRig {
  const evidence: Record<string, unknown> = {};
  let dome: PlannedRig["dome"];
  const measureDome = (): Vec => {
    if (!dome) {
      if (!plan.face) failStage("rig", "PLAN_FACE", "domeCenter needs a face section");
      const head = index.part(plan.face.head);
      const field = measureDomeField(head.alpha, head.width, head.height, head.affine, {
        anchor: solver.get(plan.face.anchor),
      });
      dome = { field, foldLimit: domeFoldLimit(field) };
      evidence.dome = dome;
    }
    return dome.field.center;
  };
  const solver = new JointSolver(index, plan.joints, measureDome);
  const bones: Bone[] = [];
  const world = new Map<string, WorldFrame>();
  const art = plan.artAngle ?? 0;
  const add = (
    id: string,
    parentId: string | undefined,
    origin: Vec,
    worldAngle: number,
    length: number,
  ) => {
    if (world.has(id)) failStage("rig", "PLAN_BONE_DUPLICATE", `Bone ${id} is planned twice`);
    const p = parentId ? world.get(parentId) : { o: [0, 0] as Vec, a: 0 };
    if (!p)
      failStage("rig", "PLAN_BONE_PARENT", `Bone ${id} needs parent ${parentId} planned earlier`);
    const pr = (p.a * Math.PI) / 180,
      d: Vec = [origin[0] - p.o[0], origin[1] - p.o[1]];
    const x = d[0] * Math.cos(pr) + d[1] * Math.sin(pr),
      y = -d[0] * Math.sin(pr) + d[1] * Math.cos(pr);
    let rot = worldAngle - p.a;
    while (rot > 180) rot -= 360;
    while (rot <= -180) rot += 360;
    bones.push({
      id,
      name: id,
      ...(parentId ? { parentId } : {}),
      x: +x.toFixed(3),
      y: +y.toFixed(3),
      rotation: +rot.toFixed(4),
      length: +length.toFixed(3),
    });
    world.set(id, { o: origin, a: worldAngle });
  };
  const chains: Record<string, string[]> = {};
  for (const entry of plan.bones) {
    if ("chain" in entry) {
      const c = entry.chain,
        n = c.bones,
        prefix = c.prefix ?? c.part.replace(/[^A-Za-z0-9_]/g, "_");
      const js = strandJoints(index.opaque(c.part), n, c.from ?? "top");
      evidence[`${c.part}:strand`] = js.map((j) => j.map((v) => Math.round(v * 10) / 10));
      const ids: string[] = [];
      for (let k = 0; k < n; k++) {
        const id = `${prefix}_${k + 1}`;
        add(
          id,
          k ? ids[k - 1] : c.parent,
          js[k]!,
          angleOf(js[k]!, js[k + 1]!),
          dist(js[k]!, js[k + 1]!),
        );
        ids.push(id);
      }
      if (chains[c.part]) failStage("rig", "PLAN_CHAIN_DUPLICATE", `Part ${c.part} has two chains`);
      chains[c.part] = ids;
      continue;
    }
    const at = solver.get(entry.at);
    if (entry.to !== undefined) {
      const to = solver.get(entry.to);
      add(entry.id, entry.parent, at, angleOf(at, to), entry.length ?? dist(at, to));
    } else {
      const angle = entry.angle === "art" ? art : (entry.angle ?? 0);
      add(entry.id, entry.parent, at, angle, entry.length ?? 0);
    }
  }
  if (plan.face) measureDome();
  const joints = solver.solveAll();
  Object.assign(evidence, solver.evidence);
  const rig: RigSpec = {
    schemaVersion: "0.1",
    kind: "rig",
    id: `${plan.id}-rig`,
    name: plan.name,
    type: "custom",
    bones,
  };
  return { rig, world, chains, joints, ...(dome ? { dome } : {}), evidence };
}
