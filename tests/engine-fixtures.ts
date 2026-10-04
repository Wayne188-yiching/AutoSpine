import type { MeshSpec, RigSpec } from "@autospine/schemas";
import { generateChainRig } from "@autospine/rig";

export function stripFixture(sections = 16, halfWidth = 3): { mesh: MeshSpec; rig: RigSpec } {
  const vertices: [number, number][] = [],
    triangles: number[] = [];
  for (let i = 0; i <= sections; i++) vertices.push([i * 5, -halfWidth], [i * 5, halfWidth]);
  for (let i = 0; i < sections; i++)
    triangles.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  const hull = [
    ...Array.from({ length: sections + 1 }, (_, i) => 2 * i),
    ...Array.from({ length: sections + 1 }, (_, i) => 2 * (sections - i) + 1),
  ];
  return {
    mesh: {
      schemaVersion: "0.1",
      kind: "mesh",
      id: "strip",
      name: "Strip",
      sourcePartId: "strip-part",
      vertices,
      uvs: vertices.map((p) => [p[0] / (sections * 5), (p[1] + halfWidth) / (halfWidth * 2)]),
      triangles,
      hull,
    },
    rig: generateChainRig({
      id: "strip-rig",
      name: "Strip rig",
      start: [0, 0],
      end: [sections * 5, 0],
      boneCount: 3,
    }),
  };
}
