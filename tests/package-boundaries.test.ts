import { describe, expect, it } from "vitest";

import { SPEC_SCHEMAS } from "@autospine/core";
import * as spine from "@autospine/spine";

describe("Gate 0 package boundaries", () => {
  it("exposes the shared IR through core", () => {
    expect(Object.keys(SPEC_SCHEMAS)).toHaveLength(8);
  });

  it("keeps the Spine 4.0.64 compiler in the adapter package", () => {
    expect(spine.SPINE_COMPATIBILITY_TARGET).toBe("4.0.64");
    expect(spine.compileSpine40).toBeTypeOf("function");
  });
});
