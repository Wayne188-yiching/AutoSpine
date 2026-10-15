import type { CharacterPlan, JointRef, JointRule } from "@autospine/schemas";
import { num } from "./joints.js";
import { motionFor } from "./motion.js";

export interface PlanLint {
  /** Problems that make the build fail or silently wrong. */
  errors: string[];
  /** Legal but suspicious (unused parameters, start values outside the search range). */
  warnings: string[];
  /** Every bone the plan creates, in order (chain bones expanded). */
  bones: string[];
  params: { referenced: string[]; unused: string[] };
}

const isParamString = (v: unknown): v is string =>
  typeof v === "string" && (v.startsWith("$") || v.startsWith("-$") || v.startsWith("="));

/**
 * Cross-reference check of a schema-valid plan, before any pixels are read: joints, bones,
 * parents, meshes, constraints, motion controls, parameter references and expressions. With
 * `partNames` (slot names and `slot#attachment` keys of the images-only layout) it also checks
 * every part the plan names. Cheap enough to run after every edit of a plan.
 */
export function lintCharacterPlan(plan: CharacterPlan, partNames?: Iterable<string>): PlanLint {
  const parts = partNames ? [...partNames] : undefined;
  const own = plan.motion.animations.filter((a) => a.motion);
  if (!own.length) return lintOne(plan, parts);
  // ADR-031: an animation with its own motion is checked on that motion, the rest on the plan's.
  const shared = plan.motion.animations.filter((a) => !a.motion);
  // Keys for the other animations are checked in their own run.
  const known = new Set(plan.motion.animations.map((a) => a.name));
  const runs = [
    ...(shared.length
      ? [lintOne({ ...plan, motion: { ...plan.motion, animations: shared } }, parts, known)]
      : []),
    ...own.map((a) => lintOne({ ...plan, motion: motionFor(plan.motion, a) }, parts, known)),
  ];
  return {
    errors: [...new Set(runs.flatMap((r) => r.errors))],
    warnings: [...new Set(runs.flatMap((r) => r.warnings))],
    bones: runs[0]!.bones,
    params: {
      referenced: [...new Set(runs.flatMap((r) => r.params.referenced))],
      unused: [...new Set(runs.flatMap((r) => r.params.unused))].filter(
        (p) => !runs.some((r) => r.params.referenced.includes(p)),
      ),
    },
  };
}

function lintOne(
  plan: CharacterPlan,
  partNames?: Iterable<string>,
  knownAnimations?: ReadonlySet<string>,
): PlanLint {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parts = partNames ? new Set(partNames) : undefined;
  // Slot names are the part names without a `#attachment` suffix.
  const slotNames = parts ? new Set([...parts].map((p) => p.split("#")[0]!)) : undefined;
  // A slot hidden in setup is named by its slot when it has exactly one `slot#attachment` part.
  const hidden = (name: string) => [...(parts ?? [])].filter((p) => p.startsWith(name + "#"));
  const part = (name: string, where: string) => {
    if (parts && !parts.has(name) && hidden(name).length !== 1)
      errors.push(`${where}: no part ${name} in the images-only layout`);
  };

  // Joints: references, inline rules, cycles.
  const jointIds = new Set(Object.keys(plan.joints));
  const deps = new Map<string, Set<string>>();
  const visitRef = (ref: JointRef, where: string, into?: Set<string>) => {
    if (typeof ref === "string") {
      if (!jointIds.has(ref)) errors.push(`${where}: unknown joint ${ref}`);
      into?.add(ref);
    } else visitRule(ref, where, into);
  };
  const visitRule = (rule: JointRule, where: string, into?: Set<string>) => {
    switch (rule.rule) {
      case "centroid":
      case "center":
      case "end":
        part(rule.part, where);
        break;
      case "overlap":
        rule.parts.forEach((p) => part(p, where));
        break;
      case "axisEnd":
        part(rule.part, where);
        if ((rule.pick === "near" || rule.pick === "far") && rule.ref === undefined)
          errors.push(`${where}: pick ${rule.pick} needs a ref`);
        if (rule.ref !== undefined) visitRef(rule.ref, where, into);
        break;
      case "lerp":
        visitRef(rule.a, where, into);
        visitRef(rule.b, where, into);
        break;
      case "align":
        visitRef(rule.x, where, into);
        visitRef(rule.y, where, into);
        break;
      case "project":
        visitRef(rule.point, where, into);
        visitRef(rule.a, where, into);
        visitRef(rule.b, where, into);
        break;
      case "narrowest":
        part(rule.part, where);
        visitRef(rule.a, where, into);
        visitRef(rule.b, where, into);
        if (rule.range[0] >= rule.range[1]) errors.push(`${where}: narrowest range must increase`);
        break;
      case "domeCenter":
        if (!plan.face) errors.push(`${where}: domeCenter needs a face block`);
        break;
      case "point":
        break;
    }
  };
  for (const [id, rule] of Object.entries(plan.joints)) {
    const d = new Set<string>();
    visitRule(rule, `joints.${id}`, d);
    deps.set(id, d);
  }
  const state = new Map<string, 1 | 2>();
  const cycle = (id: string, path: string[]): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) {
      errors.push(`joints: cycle ${[...path.slice(path.indexOf(id)), id].join(" -> ")}`);
      return true;
    }
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (deps.has(d) && cycle(d, [...path, id])) return true;
    state.set(id, 2);
    return false;
  };
  for (const id of deps.keys()) if (cycle(id, [])) break;

  // Bones in plan order; parents must come first.
  const bones: string[] = [];
  const boneSet = new Set<string>();
  const chains = new Map<string, string[]>();
  const addBone = (id: string, parent: string | undefined, where: string) => {
    if (boneSet.has(id)) errors.push(`${where}: bone ${id} is planned twice`);
    if (parent !== undefined && !boneSet.has(parent))
      errors.push(`${where}: parent ${parent} must be planned before ${id}`);
    bones.push(id);
    boneSet.add(id);
  };
  plan.bones.forEach((entry, i) => {
    if ("chain" in entry) {
      const c = entry.chain,
        where = `bones[${i}] chain ${c.part}`;
      part(c.part, where);
      if (chains.has(c.part)) errors.push(`${where}: part has two chains`);
      const prefix = c.prefix ?? c.part.replace(/[^A-Za-z0-9_]/g, "_");
      const ids = Array.from({ length: c.bones }, (_, k) => `${prefix}_${k + 1}`);
      ids.forEach((id, k) => addBone(id, k ? ids[k - 1] : c.parent, where));
      chains.set(c.part, ids);
      if (c.near !== undefined) visitRef(c.near, where);
      return;
    }
    const where = `bones[${i}] ${entry.id}`;
    addBone(entry.id, entry.parent, where);
    visitRef(entry.at, where);
    if (entry.to !== undefined) visitRef(entry.to, where);
    if (entry.to !== undefined && entry.angle !== undefined)
      warnings.push(`${where}: angle is ignored when to is given`);
  });
  const bone = (id: string, where: string) => {
    if (!boneSet.has(id)) errors.push(`${where}: unknown bone ${id}`);
  };

  if (plan.face) {
    const f = plan.face;
    part(f.head, "face.head");
    visitRef(f.anchor, "face.anchor");
    const layerBones = (f.layers ?? []).map((l) => l.bone);
    for (const b of layerBones)
      if (f.followers.includes(b) || b === f.control || b === f.base || b === f.counter)
        errors.push(`face.layers: ${b} is already a face bone or follower`);
    if (new Set(layerBones).size !== layerBones.length)
      errors.push("face.layers: a bone is listed twice");
    for (const b of [
      f.base,
      f.control,
      ...(f.counter ? [f.counter] : []),
      ...f.followers,
      ...layerBones,
    ])
      bone(b, "face");
  }

  // Meshes: a transfer may only read meshes planned before it.
  const meshed = new Set<string>();
  (plan.meshes ?? []).forEach((m, i) => {
    const where = `meshes[${i}] ${m.part}`;
    part(m.part, where);
    if (meshed.has(m.part)) errors.push(`${where}: part is meshed twice`);
    const w = m.weights;
    switch (w.type) {
      case "chain":
        if (!w.bones === !w.chain)
          errors.push(`${where}: chain weights need exactly one of bones or chain`);
        w.bones?.forEach((b) => bone(b, where));
        if (w.chain && !chains.has(w.chain))
          errors.push(`${where}: no bone chain on part ${w.chain}`);
        break;
      case "gradient":
        bone(w.from, where);
        bone(w.to, where);
        break;
      case "dome":
        if (!plan.face) errors.push(`${where}: dome weights need a face block`);
        break;
      case "transfer":
        for (const s of w.sources)
          if (!meshed.has(s)) errors.push(`${where}: transfer source ${s} must be meshed earlier`);
        for (const p of w.proxies ?? []) {
          part(p.part, where);
          bone(p.bone, where);
        }
        break;
      case "rigid":
        bone(w.bone, where);
        break;
      case "nearest":
        w.bones.forEach((b) => bone(b, where));
        break;
    }
    meshed.add(m.part);
  });
  // Regions are keyed by slot: a slot hidden in setup has only `slot#attachment` parts.
  for (const [p, b] of Object.entries(plan.regions ?? {})) {
    if (slotNames && !slotNames.has(p))
      errors.push(`regions.${p}: no slot ${p} in the images-only layout`);
    bone(b, `regions.${p}`);
  }
  // Every placed image needs a mesh (by key or slot) or a region bone (by slot).
  if (parts)
    for (const key of parts) {
      const slot = key.split("#")[0]!;
      if (!meshed.has(key) && !meshed.has(slot) && !plan.regions?.[slot])
        errors.push(`layout: ${key} has no mesh and no region bone; add it to meshes or regions`);
    }
  for (const ik of plan.constraints?.ik ?? []) {
    ik.bones.forEach((b) => bone(b, `ik ${ik.name}`));
    bone(ik.target, `ik ${ik.name}`);
  }
  for (const t of plan.constraints?.transform ?? []) {
    t.bones.forEach((b) => bone(b, `transform ${t.name}`));
    bone(t.target, `transform ${t.name}`);
  }

  // Motion: controls, animations, parameters.
  const m = plan.motion;
  const anims = new Set(m.animations.map((a) => a.name));
  const known = knownAnimations ?? anims;
  // Part sets (ADR-021): shown parts must resolve to one attachment; a slot is listed once.
  for (const a of m.animations) {
    const where = `motion.animations ${a.name}`;
    const listed = new Set<string>();
    const once = (slot: string) => {
      if (listed.has(slot)) errors.push(`${where}: slot ${slot} is listed twice in show/hide`);
      listed.add(slot);
    };
    for (const entry of a.show ?? []) {
      const slot = entry.split("#")[0]!;
      once(slot);
      if (parts && !parts.has(entry) && !parts.has(slot) && hidden(slot).length !== 1)
        errors.push(`${where}: show ${entry} needs one attachment; name it as slot#attachment`);
    }
    for (const slot of a.hide ?? []) {
      once(slot);
      if (slotNames && !slotNames.has(slot))
        errors.push(`${where}: hide names unknown slot ${slot}`);
    }
    // Rest pose (ADR-024): planned bones with finite offsets.
    for (const [id, p] of Object.entries(a.pose ?? {})) {
      bone(id, `${where} pose`);
      if ([p.x, p.y, p.rotate].some((v) => v !== undefined && !Number.isFinite(v)))
        errors.push(`${where}: pose ${id} needs finite offsets`);
    }
  }
  // Swaps (ADR-027): known slot and animation, frames inside the animation.
  for (const sw of m.swaps ?? []) {
    if (slotNames && !slotNames.has(sw.slot)) errors.push(`motion.swaps: unknown slot ${sw.slot}`);
    for (const [name, keys] of Object.entries(sw.keys)) {
      const a = m.animations.find((x) => x.name === name);
      if (!a) {
        if (!known.has(name)) errors.push(`motion.swaps ${sw.slot}: unknown animation ${name}`);
      } else if (keys.some((k) => k.frame > a.frames))
        errors.push(`motion.swaps ${sw.slot}: a key is past the end of ${name}`);
    }
  }
  for (const a of m.animations)
    if (a.frames % m.cycle !== 0)
      warnings.push(
        `motion.animations ${a.name}: ${a.frames} frames is not a whole number of ${m.cycle}-frame cycles`,
      );
  const controlIds = new Set<string>();
  const control = (c: { id: string; bone: string }, where: string) => {
    bone(c.bone, where);
    if (controlIds.has(c.id)) errors.push(`${where}: control id ${c.id} is used twice`);
    controlIds.add(c.id);
  };
  control(m.main, "motion.main");
  if (m.main.shape === "breath") {
    const ignored = (["up", "hold", "rise", "holdDepth"] as const).filter(
      (k) => m.main[k] !== undefined,
    );
    if (ignored.length) warnings.push(`motion.main: a breath ignores ${ignored.join(", ")}`);
    m.beats?.forEach((b, i) => {
      if (b.up !== undefined || b.hold !== undefined)
        warnings.push(`motion.beats[${i}]: a breath keys only rest and down`);
    });
  } else
    for (const k of ["up", "hold", "rise"] as const)
      if (m.main[k] === undefined) errors.push(`motion.main: a settle cycle needs ${k}`);
  m.beats?.forEach((c, i) => control(c, `motion.beats[${i}]`));
  m.sink?.forEach((s, i) => {
    const where = `motion.sink[${i}]`;
    if (s.kind === "legs")
      for (const l of s.legs) {
        [l.thigh, l.calf, l.foot].forEach((b) => bone(b, where));
        for (const id of [`th${l.side}`, `ft${l.side}`]) {
          if (controlIds.has(id)) errors.push(`${where}: control id ${id} is used twice`);
          controlIds.add(id);
        }
      }
    else {
      control(s, where);
      if (s.kind === "face" && (s.y === undefined) === (s.parallax === undefined))
        errors.push(`${where}: give exactly one of y and parallax`);
    }
  });
  m.follow?.forEach((c, i) => {
    const where = `motion.follow[${i}]`;
    control(c, where);
    if ((c.gain === undefined) === (c.travel === undefined))
      errors.push(`${where}: give exactly one of gain and travel`);
    if (c.travel !== undefined && (c.to === undefined || c.channel !== "rotate"))
      errors.push(`${where}: travel needs a rotate control and to`);
    if (c.to !== undefined) bone(c.to, where);
  });
  m.waves?.forEach((w, i) => {
    const ids = chains.get(w.chain);
    if (!ids) errors.push(`motion.waves[${i}]: no bone chain on part ${w.chain}`);
    // Each chain bone gets its own rotate control, named after the bone.
    for (const b of ids ?? []) control({ id: `${b}_r`, bone: b }, `motion.waves[${i}]`);
  });
  m.cycles?.forEach((c, i) => {
    control(c, `motion.cycles[${i}]`);
    const set = [c.peak, c.phase, c.phaseFraction].filter((x) => x !== undefined).length;
    if (set > 1) errors.push(`motion.cycles[${i}]: give at most one of peak, phase, phaseFraction`);
  });
  m.keyed?.forEach((c, i) => {
    const where = `motion.keyed[${i}]`;
    control(c, where);
    let move: number | undefined;
    if (c.move !== undefined)
      try {
        move = Math.round(num(c.move, m.params, `${where}.move`));
        if (move < 1) errors.push(`${where}: move must be >= 1 frame`);
      } catch {
        // reported by the parameter walk below
      }
    for (const [a, keys] of Object.entries(c.keys)) {
      const anim = m.animations.find((x) => x.name === a);
      if (!anim) {
        if (!known.has(a)) errors.push(`${where}: unknown animation ${a}`);
        continue;
      }
      if (move === undefined || move < 1) continue;
      // Saccades: each look starts after the previous one arrives and leaves room to close.
      const frames = keys.map((k) => k.frame).sort((x, y) => x - y);
      frames.forEach((f, j) => {
        if (j > 0 && f < frames[j - 1]! + move!)
          errors.push(`${where}: ${a} look at ${f} starts before the previous one arrives`);
      });
      // A one-shot (ADR-030) may end on its last look.
      const tail = anim.loop === false ? move : 2 * move;
      if (frames.length && frames.at(-1)! + tail > anim.frames)
        errors.push(
          `${where}: ${a} needs ${2 * move} frames after the last look to close the loop`,
        );
    }
  });
  // Colour blocks address slots, not bones; one block per slot in any one animation.
  const coloured = new Map<string, { id: string; anims: string[] }[]>();
  const colourSlot = (slot: string, id: string, anims: string[], where: string) => {
    if (slotNames && !slotNames.has(slot)) errors.push(`${where}: unknown slot ${slot}`);
    const list = coloured.get(slot) ?? [];
    const prev = list.find((o) => o.id !== id && o.anims.some((a) => anims.includes(a)));
    if (prev) errors.push(`${where}: slot ${slot} is already coloured by ${prev.id}`);
    coloured.set(slot, [...list, { id, anims }]);
  };
  const allAnims = m.animations.map((a) => a.name);
  m.pulses?.forEach((p, i) => {
    const where = `motion.pulses[${i}]`;
    if (controlIds.has(p.id)) errors.push(`${where}: control id ${p.id} is used twice`);
    controlIds.add(p.id);
    p.slots.forEach((s) => colourSlot(s, p.id, allAnims, where));
    if (typeof p.period === "number")
      for (const a of m.animations)
        if (a.loop !== false && a.frames % p.period !== 0)
          errors.push(
            `${where}: period ${p.period} does not divide ${a.name} (${a.frames} frames)`,
          );
  });
  m.colors?.forEach((c, i) => {
    const where = `motion.colors[${i}]`;
    if (controlIds.has(c.id)) errors.push(`${where}: control id ${c.id} is used twice`);
    controlIds.add(c.id);
    c.slots.forEach((s) => colourSlot(s, c.id, Object.keys(c.keys), where));
    for (const a of Object.keys(c.keys))
      if (!known.has(a)) errors.push(`${where}: unknown animation ${a}`);
  });
  const referenced = new Set<string>();
  const walk = (v: unknown, path: string) => {
    if (isParamString(v)) {
      for (const name of v.match(/\$[A-Za-z_][A-Za-z0-9_]*/g) ?? []) referenced.add(name.slice(1));
      try {
        num(v, m.params, path);
      } catch (e) {
        errors.push((e as Error).message.replace(/^[A-Z_]+: /, ""));
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v))
        if (path !== "motion" || (k !== "params" && k !== "search")) walk(x, `${path}.${k}`);
  };
  walk(m, "motion");
  for (const [k, r] of Object.entries(m.search ?? {})) {
    const v = m.params[k];
    if (v === undefined) errors.push(`motion.search.${k}: not a parameter`);
    else if (!r.cyclic && (v < r.min || v > r.max))
      warnings.push(`motion.search.${k}: start ${v} outside [${r.min}, ${r.max}]`);
    if (r.min > r.max) errors.push(`motion.search.${k}: min > max`);
    if (!referenced.has(k)) warnings.push(`motion.search.${k}: searched but never referenced`);
  }
  const unused = Object.keys(m.params).filter((k) => !referenced.has(k));
  for (const k of unused) warnings.push(`motion.params.${k}: never referenced`);

  // QA.
  const qa = plan.qa;
  for (const [a, b] of qa?.seams ?? []) {
    for (const p of [a, b]) if (!meshed.has(p)) errors.push(`qa.seams: ${p} is not meshed`);
  }
  for (const a of Object.keys(qa?.at ?? {}))
    if (!known.has(a)) errors.push(`qa.at: unknown animation ${a}`);
  const pr = qa?.probes;
  if (pr) {
    for (const k of ["face", "eyes", "pupils"] as const) if (pr[k]) part(pr[k], `qa.probes.${k}`);
    pr.chain?.forEach(([, p]) => part(p, "qa.probes.chain"));
    if (pr.hand) part(pr.hand[1], "qa.probes.hand");
  }
  for (const re of qa?.deformExclude ?? []) {
    try {
      new RegExp(re);
    } catch {
      errors.push(`qa.deformExclude: invalid regular expression ${re}`);
    }
  }
  return { errors, warnings, bones, params: { referenced: [...referenced].sort(), unused } };
}
