import type { AnimationSpec, CharacterPlan, KeyCurve, KeyposeEase } from "@autospine/schemas";
import { addTracks, poseTrack, shiftTrack, trackValue, type TrackKey } from "@autospine/motion";

export type RestPose = NonNullable<CharacterPlan["motion"]["animations"][number]["pose"]>;

/**
 * Adds a rest pose (ADR-024) to an animation: every key of the bone's rotate and translate
 * timelines is offset, and a bone without one gets a constant timeline. Values are IR offsets
 * from setup (y down, clockwise degrees), like every other bone timeline.
 */
export function applyRestPose(animation: AnimationSpec, pose: RestPose | undefined): AnimationSpec {
  if (!pose || !Object.keys(pose).length) return animation;
  const out = structuredClone(animation);
  const r = (v: number) => +v.toFixed(4);
  for (const [boneId, p] of Object.entries(pose)) {
    if (p.rotate) {
      const tl = (out.rotationTimelines ??= []).find((t) => t.boneId === boneId);
      if (tl) for (const k of tl.keys) k.degrees = r(k.degrees + p.rotate);
      else
        out.rotationTimelines.push({
          boneId,
          keys: [
            { time: 0, degrees: r(p.rotate) },
            { time: out.duration, degrees: r(p.rotate) },
          ],
        });
    }
    if (p.x || p.y) {
      const dx = p.x ?? 0,
        dy = p.y ?? 0;
      const tl = (out.translationTimelines ??= []).find((t) => t.boneId === boneId);
      if (tl)
        for (const k of tl.keys) {
          k.x = r(k.x + dx);
          k.y = r(k.y + dy);
        }
      else
        out.translationTimelines.push({
          boneId,
          keys: [
            { time: 0, x: r(dx), y: r(dy) },
            { time: out.duration, x: r(dx), y: r(dy) },
          ],
        });
    }
  }
  return out;
}

export type Keyposes = NonNullable<CharacterPlan["motion"]["animations"][number]["keyposes"]>;
/** One bone channel of the key pose layer, in frames: none on frame 0 unless a key sits there. */
function layerTrack(
  sorted: Keyposes,
  boneId: string,
  rotate: boolean,
  frames: number,
  loop: boolean,
): TrackKey[] {
  const entries = sorted.map((k) => {
    const p = k.pose[boneId];
    return {
      frame: k.frame,
      value: rotate ? [p?.rotate ?? 0] : [p?.x ?? 0, p?.y ?? 0],
      ...(k.ease !== undefined ? { ease: k.ease } : {}),
    };
  });
  if (!entries.length || entries[0]!.frame > 0)
    entries.unshift({ frame: 0, value: rotate ? [0] : [0, 0] });
  return poseTrack(entries, frames, loop);
}
/**
 * Key poses fitted over a build that already has some (ADR-033): on each fitted frame the build's
 * layer plus the new offsets; existing keys on other frames stay. Offsets as `fit-pose` rounds them.
 */
export function addKeyposes(
  existing: Keyposes | undefined,
  fitted: readonly { frame: number; pose: RestPose }[],
  frames: number,
  loop: boolean,
  ease?: KeyposeEase,
): Keyposes {
  const sorted = [...(existing ?? [])].sort((a, b) => a.frame - b.frame);
  const bones = new Set([...sorted, ...fitted].flatMap((k) => Object.keys(k.pose)));
  const out = new Map(sorted.map((k) => [k.frame, k] as const));
  for (const f of fitted) {
    const pose: RestPose = {};
    for (const boneId of bones) {
      const add = f.pose[boneId] ?? {},
        rotate = trackValue(layerTrack(sorted, boneId, true, frames, loop), f.frame)[0]!,
        [x, y] = trackValue(layerTrack(sorted, boneId, false, frames, loop), f.frame) as [
          number,
          number,
        ];
      const p = {
        x: +(x + (add.x ?? 0)).toFixed(2),
        y: +(y + (add.y ?? 0)).toFixed(2),
        rotate: +(rotate + (add.rotate ?? 0)).toFixed(3),
      };
      const kept = {
        ...(Math.abs(p.x) >= 0.05 ? { x: p.x } : {}),
        ...(Math.abs(p.y) >= 0.05 ? { y: p.y } : {}),
        ...(Math.abs(p.rotate) >= 0.01 ? { rotate: p.rotate } : {}),
      };
      if (Object.keys(kept).length) pose[boneId] = kept;
    }
    const was = out.get(f.frame)?.ease,
      arrival = ease ?? was;
    out.set(f.frame, { frame: f.frame, ...(arrival !== undefined ? { ease: arrival } : {}), pose });
  }
  return [...out.values()].sort((a, b) => a.frame - b.frame);
}
type Timeline = { boneId: string; keys: { time: number; curve?: KeyCurve }[] };
/**
 * Adds key poses (ADR-033): per bone and channel, a layer keyed on the key frames and eased between
 * them (no offset on frame 0 unless a key sits there; a one-shot holds its last key, a loop returns
 * to frame 0) is added to the animation's timeline, so follows and waves stay on top of the poses.
 * `lag` plays a bone's layer that many frames later, or earlier when negative (ADR-040): a loop
 * wraps, a one-shot holds its first and last values.
 */
export function applyKeyposes(
  animation: AnimationSpec,
  keyposes: Keyposes | undefined,
  fps: number,
  lag: Readonly<Record<string, number>> = {},
): AnimationSpec {
  if (!keyposes?.length) return animation;
  const out = structuredClone(animation),
    frames = Math.round(animation.duration * fps),
    r = (v: number) => +v.toFixed(4);
  const sorted = [...keyposes].sort((a, b) => a.frame - b.frame);
  const channels: { boneId: string; rotate: boolean }[] = [];
  for (const boneId of new Set(sorted.flatMap((k) => Object.keys(k.pose)))) {
    const at = sorted.map((k) => k.pose[boneId]);
    if (at.some((p) => p?.rotate !== undefined)) channels.push({ boneId, rotate: true });
    if (at.some((p) => p?.x !== undefined || p?.y !== undefined))
      channels.push({ boneId, rotate: false });
  }
  for (const { boneId, rotate } of channels) {
    const rest = rotate ? [0] : [0, 0],
      layer = shiftTrack(
        layerTrack(sorted, boneId, rotate, frames, animation.loop),
        lag[boneId] ?? 0,
        frames,
        animation.loop,
      );
    const list = (rotate
      ? (out.rotationTimelines ??= [])
      : (out.translationTimelines ??= [])) as unknown as Timeline[];
    const index = list.findIndex((t) => t.boneId === boneId);
    const own: TrackKey[] =
      index < 0
        ? [{ frame: 0, value: rest }]
        : list[index]!.keys.map((k) => {
            const v = k as unknown as { degrees: number; x: number; y: number };
            return {
              frame: k.time * fps,
              value: rotate ? [v.degrees] : [v.x, v.y],
              ...(k.curve ? { curve: k.curve } : {}),
            };
          });
    const sum = addTracks(own, layer);
    const keys = sum.map((k, i) => ({
      time: Math.min(animation.duration, k.frame / fps),
      ...(rotate ? { degrees: r(k.value[0]!) } : { x: r(k.value[0]!), y: r(k.value[1]!) }),
      ...(k.curve && i < sum.length - 1 ? { curve: k.curve } : {}),
    }));
    const timeline = { boneId, keys } as unknown as Timeline;
    if (index < 0) list.push(timeline);
    else list[index] = timeline;
  }
  return out;
}
