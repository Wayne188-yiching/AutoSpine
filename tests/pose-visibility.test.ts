import { describe, expect, it } from "vitest";
import { fitRestPose, loadSkeleton, pose, premultiply, render } from "@autospine/reference";

const W = 80;
const image = (rgb: number[]) => {
  const rgba = new Uint8Array(W * W * 4);
  for (let i = 0; i < W * W; i++) {
    const x = i % W,
      y = Math.floor(i / W);
    const shade = 0.6 + 0.2 * Math.sin(x / 11) + 0.2 * Math.sin((x + y) / 19);
    rgba.set([...rgb.map((v) => Math.round(v * shade)), 255], 4 * i);
  }
  return { width: W, height: W, rgba };
};
const images = { back: image([220, 20, 30]), front: image([20, 180, 70]) };
const document = (offset = 0) => ({
  skeleton: { spine: "4.0.64" },
  bones: [{ name: "root" }, { name: "body", parent: "root", x: offset }],
  slots: [
    { name: "back", bone: "body", attachment: "back" },
    { name: "front", bone: "body", attachment: "front", color: "8080ffff" },
  ],
  skins: [
    {
      name: "default",
      attachments: {
        back: { back: { width: W, height: W } },
        front: { front: { width: W, height: W } },
      },
    },
  ],
  animations: { idle: {} },
});
const view = { x: -60, y: 60, width: 120, height: 120 };
const texture = (path: string) => images[path as keyof typeof images];
const picture = (offset = 0) => {
  const sk = loadSkeleton(document(offset));
  pose(sk, "idle", 0);
  const canvas = render(
    sk,
    (path) => {
      const im = texture(path);
      return premultiply(im.width, im.height, im.rgba);
    },
    { x0: view.x, y0: view.y, scale: 1, width: 120, height: 120 },
  );
  return { width: 120, height: 120, rgba: Uint8Array.from(canvas, (v) => Math.round(v * 255)) };
};

describe("pose fitting visible evidence", () => {
  it("uses an explicit mesh control when the weighted slot is parented to the root", () => {
    const source = document();
    source.slots[1]!.bone = "root";
    Object.assign(source.skins[0]!.attachments.front.front, {
      type: "mesh",
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      triangles: [0, 1, 2, 0, 2, 3],
      hull: 4,
      vertices: [-40, 40, 40, 40, 40, -40, -40, -40].flatMap((_, i, a) =>
        i % 2 ? [] : [1, 1, a[i]!, a[i + 1]!, 1],
      ),
    });
    const fit = fitRestPose(source, "idle", picture(8), texture, {
      view,
      bones: ["body"],
      translate: ["body"],
      owners: { front: "body" },
      window: 15,
      maxRotate: 10,
    });
    expect(fit.pose.body?.x).toBeCloseTo(8, 0);
    expect(fit.coverage).toBeGreaterThan(0.95);
    expect(() =>
      fitRestPose(source, "idle", picture(8), texture, {
        view,
        owners: { front: "missing" },
      }),
    ).toThrow("POSE_OWNER");
  });
  it("fits the visible tinted layer and does not move a fully covered layer to a look-alike", () => {
    const fit = fitRestPose(document(), "idle", picture(8), texture, {
      view,
      bones: ["body"],
      translate: ["body"],
      window: 15,
      maxRotate: 10,
    });
    expect(fit.coverage).toBeGreaterThan(0.95);
    expect(fit.parts.map((p) => p.slot)).toEqual(["front"]);
    expect(fit.unobserved).toContainEqual({
      slot: "back",
      reason: "occluded",
      samples: 1600,
      visible: 0,
    });
    expect(fit.pose.body?.x).toBeCloseTo(8, 0);
    expect(Math.abs(fit.pose.body?.rotate ?? 0)).toBeLessThan(0.5);
  });

  it("rejects different visible art even when the hidden layer has the right colours", () => {
    const wrong = picture();
    for (let i = 0; i < wrong.rgba.length; i += 4)
      if (wrong.rgba[i + 3]) wrong.rgba.set([220, 20, 30], i);
    const fit = fitRestPose(document(), "idle", wrong, texture, {
      view,
      bones: ["body"],
      translate: ["body"],
      window: 15,
      maxRotate: 10,
    });
    expect(fit.coverage).toBe(0);
    expect(fit.pose).toEqual({});
  });
});
