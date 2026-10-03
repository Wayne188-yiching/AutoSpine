import { describe, it, expect } from "vitest";
import {
  attachmentEntries,
  readArtistMesh,
  compareVertexPositions,
  compareManualEdges,
} from "../tools/reference-topology.mjs";

const attachment = {
  type: "mesh",
  uvs: [0, 0, 1, 0, 1, 1, 0, 1],
  hull: 4,
  triangles: [0, 1, 2, 0, 2, 3],
  edges: [0, 2, 2, 4, 4, 6, 6, 0, 0, 4],
};
const artist = () => readArtistMesh(attachment, 100, 100, "4.0.64");
describe("Source-grounded mesh comparisons", () => {
  it("reads both historical and list skin formats", () => {
    const slots = { slot: { square: attachment } };
    expect(attachmentEntries({ skins: { default: slots } })).toEqual(
      attachmentEntries({ skins: [{ name: "default", attachments: slots }] }),
    );
  });
  it("decodes XY-offset edges, separating hull, manual and automatic edges", () => {
    const m = artist();
    expect(m.boundaryEdges).toHaveLength(4);
    expect(m.manualEdges).toEqual([[0, 2]]);
    expect(m.automaticEdges).toEqual([]);
    const noManual = readArtistMesh(
      { ...attachment, edges: attachment.edges.slice(0, 8) },
      100,
      100,
      "3.8.99",
    );
    expect(noManual.automaticEdges).toHaveLength(1);
  });
  it("treats missing nonessential data as unknown rather than zero manual edges", () => {
    const missing = readArtistMesh({ ...attachment, edges: undefined }, 100, 100, "3.8.99");
    expect(missing.manualEdges).toBeNull();
    expect(missing.automaticEdges).toBeNull();
    expect(compareManualEdges(missing, artist(), [[0, 0]])).toMatchObject({ status: "BLOCKED" });
  });
  it("rejects malformed and non-triangulated source edges", () => {
    for (const edges of [[1, 2], [0], [0, 0], [0, 10], [2, 6]])
      expect(() => readArtistMesh({ ...attachment, edges }, 100, 100, "4.0.64")).toThrow();
    expect(() => readArtistMesh(attachment, 100, 100, "4.3.0")).toThrow("VERSION");
  });
  it("is invariant to reordered vertex indices and image resolution", () => {
    const a = artist(),
      g = { ...a, vertices: [a.vertices[2], a.vertices[3], a.vertices[0], a.vertices[1]] };
    const result = compareVertexPositions(a, g, 100, 100);
    expect(result.passed).toBe(true);
    expect(result.groups.hull.mean).toBe(0);
    const offset = (m, scale) => ({
      ...m,
      vertices: m.vertices.map(([x, y]) => [x * scale + scale, y * scale]),
    });
    expect(compareVertexPositions(a, offset(a, 1), 100, 100).groups.hull.mean).toBeCloseTo(
      compareVertexPositions(offset(a, 2), offset(offset(a, 1), 2), 200, 200).groups.hull.mean,
    );
  });
  it("does not hide missing interior points or match them to the hull", () => {
    const a = { ...artist(), vertices: [...artist().vertices, [50, 50]] };
    const r = compareVertexPositions(a, artist(), 100, 100);
    expect(r.groups.interior.unmatched).toBe(1);
    expect(r.passed).toBe(false);
  });
  it("prefers an exact corner over an earlier surplus point at the same bottleneck limit", () => {
    const a = artist();
    const g = {
      ...a,
      vertices: [
        [0, 0],
        [99, 0],
        [100, 100],
        [0.5, 99.8],
        [0, 100],
      ],
      hull: [0, 1, 2, 3, 4],
    };
    const result = compareVertexPositions(a, g, 100, 100);
    expect(result.pairs).toContainEqual([3, 4]);
    expect(result.passed).toBe(true);
    expect(result.maxPositionFraction).toBeCloseTo(1 / Math.hypot(100, 100));
  });
  it("detects lost manual edge even with perfect counts and positions", () => {
    const a = artist(),
      g = { ...a, triangles: [0, 1, 3, 1, 2, 3] };
    const positions = compareVertexPositions(a, g, 100, 100);
    expect(positions.passed).toBe(true);
    expect(compareManualEdges(a, g, positions.pairs)).toMatchObject({
      status: "BLOCKED",
    });
  });
  it("rejects non-finite points and bad hull indices", () => {
    expect(() =>
      compareVertexPositions(
        artist(),
        {
          ...artist(),
          vertices: [
            [NaN, 0],
            [1, 0],
            [0, 1],
          ],
        },
        100,
        100,
      ),
    ).toThrow();
    expect(() =>
      compareVertexPositions(artist(), { ...artist(), hull: [0, 1, 9] }, 100, 100),
    ).toThrow();
  });
});
