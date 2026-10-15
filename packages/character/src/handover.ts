import type { AnimationSpec } from "@autospine/schemas";
import type { CharacterRigging, SpineDocument } from "./build.js";

/**
 * Bone roles for whoever takes the file over (ADR-026): the main bone that carries the motion,
 * control bones without images (face rig, IK targets, squash bones), face followers and their
 * aligned carriers, strand chains, and ordinary joints.
 */
export type BoneRole = "main" | "control" | "follower" | "chain" | "joint";
/** Spine editor bone colours per role; joints keep the editor default. */
export const ROLE_COLORS: Readonly<Record<BoneRole, string | undefined>> = Object.freeze({
  main: "4080ffff",
  control: "ff4040ff",
  follower: "ffa040ff",
  chain: "40c040ff",
  joint: undefined,
});
const ROLE_NAMES: Readonly<Record<BoneRole, string>> = {
  main: "主骨（藍）",
  control: "控制骨（紅）",
  follower: "跟隨骨（橘）",
  chain: "骨鏈（綠）",
  joint: "關節骨（預設色）",
};

export function boneRoles(rigging: CharacterRigging): Map<string, BoneRole> {
  const plan = rigging.plan,
    face = plan.face;
  const roles = new Map<string, BoneRole>();
  for (const b of rigging.rigged.rig.bones) roles.set(b.id, "joint");
  for (const ids of Object.values(rigging.rigged.chains))
    for (const id of ids) roles.set(id, "chain");
  const followers = [
    ...(face?.followers ?? []),
    ...(face?.layers ?? []).map((l) => l.bone),
    ...((rigging.evidence.faceCarriers as string[] | undefined) ?? []),
  ];
  for (const id of followers) roles.set(id, "follower");
  // The face rig always controls; an IK target or squash bone that carries images (a planted
  // foot) stays a joint.
  const carries = new Set<string>();
  for (const m of rigging.meshes.values())
    for (const v of m.weights.vertices) for (const i of v.influences) carries.add(i.boneId);
  for (const s of rigging.slots)
    for (const a of s.attachments) if (a.kind === "region") carries.add(a.boneId);
  if (face)
    for (const id of [face.base, face.control, ...(face.counter ? [face.counter] : [])])
      roles.set(id, "control");
  for (const id of [
    ...(plan.constraints?.ik ?? []).map((c) => c.target),
    ...(plan.motion.sink ?? []).flatMap((s) => (s.kind === "squash" ? [s.bone] : [])),
  ])
    if (!carries.has(id)) roles.set(id, "control");
  roles.set(plan.motion.main.bone, "main");
  return roles;
}
/** Colours the document's bones by role (Spine shows them in the tree and the viewport). */
export function colorBones(doc: SpineDocument, roles: ReadonlyMap<string, BoneRole>): void {
  for (const b of (doc.bones ?? []) as { name: string; color?: string }[]) {
    const c = ROLE_COLORS[roles.get(b.name) ?? "joint"];
    if (c) b.color = c;
  }
}

/** Plain-language handover notes for the Spine file: structure, controls, motion, where to edit. */
export function handoverNotes(rigging: CharacterRigging, animations: AnimationSpec[]): string {
  const plan = rigging.plan,
    roles = boneRoles(rigging),
    rig = rigging.rigged.rig;
  const byRole = (r: BoneRole) => rig.bones.filter((b) => roles.get(b.id) === r).map((b) => b.id);
  const parent = new Map(rig.bones.map((b) => [b.id, b.parentId]));
  const pathTo = (id: string) => {
    const out: string[] = [];
    for (let b: string | undefined = id; b; b = parent.get(b)) out.unshift(b);
    return out.join(" → ");
  };
  const lines: string[] = [];
  const add = (s = "") => lines.push(s);
  add(`# 接手說明：${plan.name}`);
  add();
  add(
    `AutoSpine 依方案 \`${plan.id}\` 自動產生。在 Spine 4.0.64 用 Import Data 匯入 \`${plan.id}.json\`（圖片在 \`images/\`）。之後可以直接在 Spine 裡修改；手動修改不會回寫方案，要重新產生請改方案後再建置到新資料夾。`,
  );
  add();
  add("## 骨架");
  add();
  add(`共 ${rig.bones.length} 根骨。每根骨從自己的關節指向下一個關節，骨的顏色代表用途：`);
  add();
  add("| 類型 | 用途 | 骨 |");
  add("| --- | --- | --- |");
  const purpose: Record<BoneRole, string> = {
    main: "動作的主控：呼吸、下沉的位移都打在這裡",
    control: "沒有圖片，只用來驅動：臉部視差（face_ctl 等）、IK 目標、壓縮腿部的站姿骨",
    follower: "臉部五官與 2.5D 圖層，透過 transform 約束跟著臉部控制骨；`*_frame` 是對齊方向的載體",
    chain: "頭髮、尾巴、耳朵、鬍子、吊飾等軟部件的骨鏈，擺動打在這些骨的旋轉上",
    joint: "身體關節：軀幹、頸、頭、四肢、手指",
  };
  for (const r of ["main", "control", "follower", "chain", "joint"] as const) {
    const ids = byRole(r);
    if (ids.length)
      add(`| ${ROLE_NAMES[r]} | ${purpose[r]} | ${ids.map((i) => `\`${i}\``).join(" ")} |`);
  }
  add();
  const head = rig.bones.find((b) => b.id === "head");
  if (head) add(`中線：${pathTo("head")}。`);
  add();
  add("## 約束");
  add();
  const ik = plan.constraints?.ik ?? [];
  if (ik.length)
    for (const c of ik)
      add(
        `- IK \`${c.name}\`：${c.bones.map((b) => `\`${b}\``).join("、")} 指向 \`${c.target}\`（移動目標骨就能改手腳位置）。`,
      );
  for (const t of rigging.transform)
    add(
      `- Transform \`${t.name}\`：${t.boneIds.map((b) => `\`${b}\``).join("、")} 跟著 \`${t.targetId}\`，位移比例 ${+(t.mixX ?? 0).toFixed(3)}${t.local ? "（local、relative）" : ""}。調整五官跟隨的多寡改這個 mix。`,
    );
  if (!ik.length && !rigging.transform.length) add("- 無。");
  add();
  add("## 網格與權重");
  add();
  const weightName: Record<string, string> = {
    dome: "臉部圓頂（視差）",
    gradient: "兩骨漸層",
    chain: "骨鏈",
    nearest: "最近骨",
    rigid: "單骨",
    transfer: "轉移（光暈、陰影）",
  };
  for (const m of plan.meshes ?? []) {
    const w = m.weights as {
      type: string;
      from?: string;
      to?: string;
      bones?: string[];
      chain?: string;
      bone?: string;
    };
    const bones = w.from
      ? `${w.from} → ${w.to}`
      : w.bones
        ? w.bones.join("、")
        : w.chain
          ? `${w.chain} 的骨鏈`
          : (w.bone ?? "");
    add(`- \`${m.part}\`：${weightName[w.type] ?? w.type}${bones ? `（${bones}）` : ""}`);
  }
  const auto = rigging.meshes.size - (plan.meshes?.length ?? 0);
  if (auto > 0) add(`- 其他 ${auto} 個部件：依人工密度建網格，整片跟著所在的骨。`);
  add();
  add("## 動畫");
  add();
  plan.motion.animations.forEach((a, i) => {
    const spec = animations[i];
    add(`### ${a.name}（${a.frames} 幀${a.loop === false ? "，單次" : ""}）`);
    add();
    if (a.loop === false)
      add(
        "- 單次動畫：不循環，最後一幀不必等於第 0 幀；換圖和顏色停在最後的值，主動作在最後一幀回到原位。",
      );
    const moved = new Set([
      ...(spec?.rotationTimelines ?? []).map((t) => t.boneId),
      ...(spec?.translationTimelines ?? []).map((t) => t.boneId),
      ...(spec?.scaleTimelines ?? []).map((t) => t.boneId),
    ]);
    if (a.pose && Object.keys(a.pose).length)
      add(
        `- 起始姿勢：setup 姿勢沒動，這段動畫的姿勢是 ${Object.keys(a.pose)
          .map((b) => `\`${b}\``)
          .join(
            "、",
          )} 在每個關鍵幀上的固定偏移。改姿勢就改這些骨的關鍵幀（第 0 幀與最後一幀同值）。`,
      );
    if (a.show?.length) add(`- 部件組：顯示 ${a.show.length} 個 slot，用 attachment 關鍵幀切換。`);
    const m = plan.motion.main;
    add(
      `- 主動作：\`${m.bone}\` 的 ${m.channel}，${m.shape === "breath" ? "對稱呼吸" : "預備、下沉、停住、回位"}；幅度改第 ${m.down} 幀的值。`,
    );
    for (const f of plan.motion.follow ?? [])
      add(`- 跟隨：\`${f.bone}\` 的 ${f.channel} 晚主動作幾幀跟上。`);
    for (const s of plan.motion.sink ?? [])
      if (s.kind === "face") add(`- 臉部視差：\`${s.bone}\` 的 translate，五官與臉皮反向滑動。`);
      else if (s.kind === "squash")
        add(`- 壓縮：\`${s.bone}\` 的 scale，腿部跟著臀部壓縮、腳不動。`);
      else if (s.kind === "legs") add(`- 腿部：大腿縮短、腳反向縮放。`);
    for (const w of plan.motion.waves ?? [])
      add(
        `- 波動：${(rigging.rigged.chains[w.chain] ?? []).map((b) => `\`${b}\``).join("、")} 的旋轉依序擺動。`,
      );
    for (const c of plan.motion.cycles ?? []) add(`- 循環：\`${c.bone}\` 的 ${c.channel}。`);
    for (const k of plan.motion.keyed ?? [])
      if (k.keys[a.name]) add(`- 關鍵幀：\`${k.bone}\` 的 ${k.channel}。`);
    for (const p of plan.motion.pulses ?? [])
      add(`- 透明度：${p.slots.map((s) => `\`${s}\``).join("、")} 明暗變化。`);
    for (const sw of plan.motion.swaps ?? [])
      if (sw.keys[a.name])
        add(
          `- 換圖：\`${sw.slot}\` 在 ${sw.keys[a.name]!.map((k) => k.frame).join("、")} 幀切換附件（例如眨眼）。`,
        );
    add(`- 共 ${moved.size} 根骨有關鍵幀，都是稀疏關鍵幀加貝茲曲線，可以直接拖動。`);
    add();
  });
  add("## 常見調整");
  add();
  add(`- 整體幅度：改 \`${plan.motion.main.bone}\` 的關鍵幀。`);
  add("- 頭的點頭：改 `head` 的 rotate 關鍵幀。");
  if (plan.face)
    add(
      `- 臉部轉向感：改 \`${plan.face.control}\` 的 translate；五官跟得多或少改對應 Transform 約束的 mix。`,
    );
  add("- 頭髮、尾巴的擺動：改骨鏈的 rotate 關鍵幀。");
  add("- 網格與權重：Spine 的 Weights 面板可以直接重刷；新增骨就照關節命名接到對應的父骨。");
  add();
  return lines.join("\n") + "\n";
}
