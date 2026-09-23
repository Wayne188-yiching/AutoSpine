import { describe, expect, it } from "vitest";

import { SPEC_SCHEMAS } from "@autospine/core";
import * as spine from "@autospine/spine";

describe("Gate 0 package boundaries", () => {
  it("exposes the shared IR through core", () => {
    expect(Object.keys(SPEC_SCHEMAS)).toHaveLength(8);
  });

  it("declares Spine 4.3 compatibility without implementing the compiler", () => {
    expect(spine.SPINE_COMPATIBILITY_TARGET).toBe("4.3");
    expect("compileSpine43" in spine).toBe(false);
  });
});
