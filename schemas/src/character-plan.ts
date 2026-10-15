import { Type, type Static } from "@sinclair/typebox";

import { KeyposeEaseSchema } from "./keypose-spec.js";
import { IdSchema, NameSchema, SchemaVersionSchema, Vector2Schema } from "./common.js";

/**
 * Character plan (ADR-017): every character-specific decision of a multi-part build, as data.
 * The orchestration layer (`@autospine/character`) turns an images-only layout plus this plan into
 * engine IR and Spine output with the existing deterministic engines. Joints are geometric rules
 * over part pixels, never artist coordinates; part names are the source's slot names.
 *
 * Coordinates are IR world (x right, y down, degrees clockwise on screen).
 */
const strict = { additionalProperties: false };
const PartNameSchema = Type.String({ minLength: 1, maxLength: 256 });

/**
 * A number, a motion parameter reference ("$name" or "-$name"), or an arithmetic expression over
 * parameters starting with "=" (numbers, $names, + - * /, parentheses), e.g. "=2*$lag".
 */
export const PlanNumberSchema = Type.Union([
  Type.Number(),
  Type.String({ pattern: "^(-?\\$[A-Za-z_][A-Za-z0-9_]*|=[-+*/(). 0-9$A-Za-z_]{1,256})$" }),
]);
export const PlanValueSchema = Type.Union([
  PlanNumberSchema,
  Type.Tuple([PlanNumberSchema, PlanNumberSchema]),
]);

/** Joint rules: deterministic functions of part alpha in world space, or of other joints. */
export const JointRuleSchema = Type.Recursive((Self) => {
  const Ref = Type.Union([IdSchema, Self]);
  return Type.Union([
    /** Mean of the opaque pixels. */
    Type.Object({ rule: Type.Literal("centroid"), part: PartNameSchema }, strict),
    /** Centre of the image rectangle (placement, not pixels). */
    Type.Object({ rule: Type.Literal("center"), part: PartNameSchema }, strict),
    /** Centroid of the opaque overlap of two parts (a joint both images cover). */
    Type.Object(
      { rule: Type.Literal("overlap"), parts: Type.Tuple([PartNameSchema, PartNameSchema]) },
      strict,
    ),
    /** Mean of the opaque pixels within `band` px of the extreme along `dir`. */
    Type.Object(
      {
        rule: Type.Literal("end"),
        part: PartNameSchema,
        dir: Vector2Schema,
        band: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 512 })),
      },
      strict,
    ),
    /** One end of the part's principal axis: by screen side, or nearest / farthest from `ref`. */
    Type.Object(
      {
        rule: Type.Literal("axisEnd"),
        part: PartNameSchema,
        pick: Type.Union([
          Type.Literal("top"),
          Type.Literal("bottom"),
          Type.Literal("left"),
          Type.Literal("right"),
          Type.Literal("near"),
          Type.Literal("far"),
        ]),
        ref: Type.Optional(Ref),
      },
      strict,
    ),
    Type.Object(
      { rule: Type.Literal("lerp"), a: Ref, b: Ref, t: Type.Number({ minimum: -4, maximum: 4 }) },
      strict,
    ),
    /** Projection of `point` onto the line a-b. */
    Type.Object({ rule: Type.Literal("project"), point: Ref, a: Ref, b: Ref }, strict),
    /** x of one joint, y of another: a hip under its leg at the pelvis height (ADR-025). */
    Type.Object({ rule: Type.Literal("align"), x: Ref, y: Ref }, strict),
    /** Centre of the narrowest cross-section of a part between fractions of a-b (ankle, wrist). */
    Type.Object(
      {
        rule: Type.Literal("narrowest"),
        part: PartNameSchema,
        a: Ref,
        b: Ref,
        range: Type.Tuple([
          Type.Number({ minimum: 0, maximum: 1 }),
          Type.Number({ minimum: 0, maximum: 1 }),
        ]),
      },
      strict,
    ),
    /** Centre of the measured face dome (requires `face`). */
    Type.Object({ rule: Type.Literal("domeCenter") }, strict),
    /** An explicit point. Prefer pixel rules; use this for scene anchors only. */
    Type.Object({ rule: Type.Literal("point"), at: Vector2Schema }, strict),
  ]);
});
export const JointRefSchema = Type.Union([IdSchema, JointRuleSchema]);

/** A bone from `at` towards `to`, or at a fixed world angle ("art" = the plan's artAngle). */
export const BonePlanSchema = Type.Object(
  {
    id: IdSchema,
    parent: Type.Optional(IdSchema),
    at: JointRefSchema,
    to: Type.Optional(JointRefSchema),
    angle: Type.Optional(Type.Union([Type.Number(), Type.Literal("art")])),
    length: Type.Optional(Type.Number({ minimum: 0 })),
  },
  strict,
);
/** A bone chain along a strand's medial line; bones are named `${prefix}_${k}` from 1. */
export const ChainPlanSchema = Type.Object(
  {
    part: PartNameSchema,
    bones: Type.Integer({ minimum: 1, maximum: 32 }),
    parent: IdSchema,
    from: Type.Optional(Type.Union([Type.Literal("top"), Type.Literal("bottom")])),
    /** Start at the strand end nearest this joint (a bough from its trunk); overrides `from`. */
    near: Type.Optional(JointRefSchema),
    prefix: Type.Optional(IdSchema),
  },
  strict,
);

export const MeshPlanSchema = Type.Object(
  {
    /** Slot name, or `slot#attachment` for a non-setup attachment. */
    part: PartNameSchema,
    mesh: Type.Union([
      /** Silhouette mesh with locked rings around enclosed holes (ADR-016). */
      Type.Object(
        {
          type: Type.Literal("feature"),
          spacing: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
          edgeLength: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
          minHoleFraction: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          /**
           * Vertex budget (ADR-024). `artist`: s = sqrt(image width x height) px, hull round(sqrt s)
           * clamped to 6..40, interior 0 below s 100 else round(s / 80) (median of 423 artist
           * character meshes). Explicit counts override it; a budget covers holes.
           */
          density: Type.Optional(Type.Literal("artist")),
          hullVertices: Type.Optional(Type.Integer({ minimum: 3, maximum: 512 })),
          interiorVertices: Type.Optional(Type.Integer({ minimum: 0, maximum: 2048 })),
        },
        strict,
      ),
      /** Outline mesh after alpha preparation (primary component, pinches, holes). */
      Type.Object(
        {
          type: Type.Literal("contour"),
          intent: Type.Optional(
            Type.Union([Type.Literal("chain"), Type.Literal("rigid"), Type.Literal("unknown")]),
          ),
          /** Changed-pixel budgets tried in order by the alpha preparation. */
          cleanup: Type.Optional(
            Type.Array(Type.Number({ minimum: 0, maximum: 1 }), { minItems: 1, maxItems: 8 }),
          ),
        },
        strict,
      ),
      /** Regular surface grid (leafy parts whose outline exceeds the contour budget). */
      Type.Object(
        {
          type: Type.Literal("surface"),
          cols: Type.Integer({ minimum: 1, maximum: 64 }),
          rows: Type.Integer({ minimum: 1, maximum: 64 }),
        },
        strict,
      ),
      /** The image rectangle as two triangles (sheared placements, mouths, FX). */
      Type.Object({ type: Type.Literal("quad") }, strict),
    ]),
    weights: Type.Union([
      /** Joint-plane chain weights (ADR-014); blend width = blend x the shorter adjacent bone. */
      Type.Object(
        {
          type: Type.Literal("chain"),
          bones: Type.Optional(Type.Array(IdSchema, { minItems: 1, maxItems: 64 })),
          chain: Type.Optional(PartNameSchema),
          blend: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 4 })),
        },
        strict,
      ),
      /** Linear two-bone gradient (ADR-015). */
      Type.Object({ type: Type.Literal("gradient"), from: IdSchema, to: IdSchema }, strict),
      /** Face dome weights with ring pins (ADR-012/016); needs `face`. */
      Type.Object({ type: Type.Literal("dome") }, strict),
      /** Closest-point transfer from earlier meshes; proxies stand in for rigid regions (ADR-013). */
      Type.Object(
        {
          type: Type.Literal("transfer"),
          sources: Type.Array(PartNameSchema, { minItems: 1, maxItems: 16 }),
          proxies: Type.Optional(
            Type.Array(Type.Object({ part: PartNameSchema, bone: IdSchema }, strict), {
              maxItems: 8,
            }),
          ),
          maxInfluences: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
        },
        strict,
      ),
      Type.Object({ type: Type.Literal("rigid"), bone: IdSchema }, strict),
      /**
       * Inverse-distance weights to the nearest of the listed bones (their segments), smoothed
       * over the mesh: blobs driven by several bones such as a leaf cluster's radiating bones.
       */
      Type.Object(
        {
          type: Type.Literal("nearest"),
          bones: Type.Array(IdSchema, { minItems: 1, maxItems: 32 }),
          maxInfluences: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
          smoothing: Type.Optional(Type.Integer({ minimum: 0, maximum: 8 })),
        },
        strict,
      ),
    ]),
  },
  strict,
);

/** Face parallax: a dome on the head image drives follower bones through local transforms. */
export const FacePlanSchema = Type.Object(
  {
    head: PartNameSchema,
    anchor: JointRefSchema,
    base: IdSchema,
    control: IdSchema,
    counter: Type.Optional(IdSchema),
    /** Counter bone follow (negative = opposite direction); default -0.3. */
    counterMix: Type.Optional(Type.Number({ minimum: -1, maximum: 1 })),
    /** Follower bones; each samples the dome at its own origin. */
    followers: Type.Array(IdSchema, { minItems: 1, maxItems: 64 }),
    /** Ring pin margin as a fraction of the head's opaque width; default 0.12. */
    pinMargin: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    /**
     * 2.5D depth layers outside the face plate: each bone follows the control with mix = depth x
     * the measured dome peak (clamped to -1..1). depth 1 sits on the face surface at its centre,
     * above 1 in front of it (bangs, a hat brim), 0 rides the head rigidly, below 0 sits behind it
     * and moves against the turn (back hair, a ponytail root, the far ear).
     */
    layers: Type.Optional(
      Type.Array(
        Type.Object({ bone: IdSchema, depth: Type.Number({ minimum: -2, maximum: 2 }) }, strict),
        { maxItems: 64 },
      ),
    ),
  },
  strict,
);

export const IkPlanSchema = Type.Object(
  {
    name: IdSchema,
    bones: Type.Array(IdSchema, { minItems: 1, maxItems: 2 }),
    target: IdSchema,
    mix: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    /** "auto" keeps the setup elbow side. */
    bendPositive: Type.Optional(Type.Union([Type.Boolean(), Type.Literal("auto")])),
  },
  strict,
);
const mix = Type.Number({ minimum: -1, maximum: 1 });
export const TransformPlanSchema = Type.Object(
  {
    name: IdSchema,
    bones: Type.Array(IdSchema, { minItems: 1, maxItems: 64 }),
    target: IdSchema,
    mixRotate: Type.Optional(mix),
    mixX: Type.Optional(mix),
    mixY: Type.Optional(mix),
    mixScaleX: Type.Optional(mix),
    mixScaleY: Type.Optional(mix),
    mixShearY: Type.Optional(mix),
    local: Type.Optional(Type.Boolean()),
    relative: Type.Optional(Type.Boolean()),
  },
  strict,
);

const Channel = Type.Union([
  Type.Literal("rotate"),
  Type.Literal("translate"),
  Type.Literal("scale"),
]);
const Space = Type.Optional(Type.Union([Type.Literal("world"), Type.Literal("parent")]));
const control = { id: IdSchema, bone: IdSchema, channel: Channel, space: Space };
const SearchRangeSchema = Type.Object(
  {
    min: Type.Number(),
    max: Type.Number(),
    step: Type.Number({ exclusiveMinimum: 0 }),
    integer: Type.Optional(Type.Boolean()),
    /** Wraps modulo the main cycle (phases, peak frames). */
    cyclic: Type.Optional(Type.Boolean()),
  },
  strict,
);

/**
 * Motion blocks an animation may also carry for itself (ADR-031): the main cycle, its beats and
 * sink, follow, waves, cycles and pulses. Keyed tracks, swaps and colour keys are already keyed
 * per animation.
 */
const motionBlocks = {
  main: Type.Object(
    {
      ...control,
      /**
       * `settle` (default): rest, anticipation lift at `up`, sink at `down`, hold, rest; needs
       * `up`, `hold` and `rise`. `breath`: rest at the cycle start, the `depth` extreme at `down`
       * (usually half the cycle), sine both ways; the setup pose is one end of the breath.
       */
      shape: Type.Optional(Type.Union([Type.Literal("settle"), Type.Literal("breath")])),
      /** Frames inside the cycle. */
      up: Type.Optional(PlanNumberSchema),
      down: PlanNumberSchema,
      hold: Type.Optional(PlanNumberSchema),
      /** Anticipation lift and sink depth, px (positive = down at the sink). */
      rise: Type.Optional(PlanNumberSchema),
      depth: PlanNumberSchema,
      /** Extra depth reached at the end of the hold; default 1. */
      holdDepth: Type.Optional(PlanNumberSchema),
      eases: Type.Optional(
        Type.Object(
          {
            up: Type.Optional(KeyposeEaseSchema),
            down: Type.Optional(KeyposeEaseSchema),
            hold: Type.Optional(KeyposeEaseSchema),
            rest: Type.Optional(KeyposeEaseSchema),
          },
          strict,
        ),
      ),
    },
    strict,
  ),
  /** Controls keyed on the main beats; a missing beat leaves the control unkeyed there. */
  beats: Type.Optional(
    Type.Array(
      Type.Object(
        {
          ...control,
          rest: PlanValueSchema,
          up: Type.Optional(PlanValueSchema),
          down: Type.Optional(PlanValueSchema),
          hold: Type.Optional(PlanValueSchema),
          /** Multiply the anticipation value by the cycle's scale. */
          scaleUp: Type.Optional(Type.Boolean()),
        },
        strict,
      ),
      { maxItems: 128 },
    ),
  ),
  /** Values derived from the main depth on every main beat. */
  sink: Type.Optional(
    Type.Array(
      Type.Union([
        /** Thigh shortens by depth / leg vertical span; the foot counter-scales (feet stay planted). */
        Type.Object(
          {
            kind: Type.Literal("legs"),
            legs: Type.Array(
              Type.Object(
                { side: IdSchema, thigh: IdSchema, calf: IdSchema, foot: IdSchema },
                strict,
              ),
              { minItems: 1, maxItems: 8 },
            ),
          },
          strict,
        ),
        /**
         * Face slides inside the head: `y` px down at full depth (scaled by the current depth;
         * upRatio x the lift above rest, default 2/3) and `x` as a ratio of that vertical slide.
         * Or `parallax` (ADR-022): the vertical travel of the first face follower against the
         * face plate at full depth, in head widths; the engine derives the slide from the dome
         * weights. `move` holds the face between main beats and moves it within `move` frames.
         */
        Type.Object(
          {
            kind: Type.Literal("face"),
            ...control,
            y: Type.Optional(PlanNumberSchema),
            parallax: Type.Optional(PlanNumberSchema),
            x: PlanNumberSchema,
            upRatio: Type.Optional(Type.Number()),
            move: Type.Optional(PlanNumberSchema),
          },
          strict,
        ),
        /** A chain root shortens by amount at full depth (strands settling onto the body). */
        Type.Object(
          {
            kind: Type.Literal("squash"),
            id: IdSchema,
            bone: IdSchema,
            amount: Type.Optional(PlanNumberSchema),
            /**
             * Instead of `amount` (ADR-025): the bone's tip follows the main's vertical offset,
             * scale = 1 - y / its vertical extent. A vertical stance bone from the ankles to the
             * pelvis squashes the legs it carries in step with the hips, feet planted.
             */
            track: Type.Optional(Type.Boolean()),
          },
          strict,
        ),
      ]),
      { maxItems: 64 },
    ),
  ),
  /**
   * Overlap: rotate with the main control's vertical offset, delayed by lag frames. Give `gain`
   * (degrees per px), or `travel` with `to`: the `to` bone then moves `travel` times the main's
   * vertical travel relative to `bone` (a rotate control; gain = travel x 180/pi / distance from
   * `bone` to `to`). A positive travel moves it with the main when it sits beside the pivot.
   */
  follow: Type.Optional(
    Type.Array(
      Type.Object(
        {
          ...control,
          gain: Type.Optional(PlanNumberSchema),
          travel: Type.Optional(PlanNumberSchema),
          to: Type.Optional(IdSchema),
          lag: PlanNumberSchema,
        },
        strict,
      ),
      { maxItems: 128 },
    ),
  ),
  /** Follow-through waves on bone chains: root follows, outer bones oscillate with phase steps. */
  waves: Type.Optional(
    Type.Array(
      Type.Object(
        {
          chain: PartNameSchema,
          amp: PlanNumberSchema,
          rootGain: PlanNumberSchema,
          rootGainScale: Type.Optional(Type.Number()),
          rootLag: Type.Optional(PlanNumberSchema),
          peak: PlanNumberSchema,
          growth: PlanNumberSchema,
          step: PlanNumberSchema,
        },
        strict,
      ),
      { maxItems: 128 },
    ),
  ),
  cycles: Type.Optional(
    Type.Array(
      Type.Object(
        {
          ...control,
          amplitude: PlanValueSchema,
          /** Frames, or "animation" for one period per animation. */
          period: Type.Union([PlanNumberSchema, Type.Literal("animation")]),
          /** Frame of the positive extreme, or a raw phase, or a fraction of the animation. */
          peak: Type.Optional(PlanNumberSchema),
          phase: Type.Optional(PlanNumberSchema),
          phaseFraction: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        },
        strict,
      ),
      { maxItems: 128 },
    ),
  ),
  /**
   * Slot transparency pulses (lights, glows): alpha oscillates between `low` and `high` times the
   * setup alpha, peaking at `peak`; each further slot peaks `stagger` frames later (a chase). The
   * period ("animation", "cycle" or frames) must divide every animation so the loop stays seamless.
   */
  pulses: Type.Optional(
    Type.Array(
      Type.Object(
        {
          id: IdSchema,
          slots: Type.Array(PartNameSchema, { minItems: 1, maxItems: 64 }),
          low: PlanNumberSchema,
          high: PlanNumberSchema,
          period: Type.Union([PlanNumberSchema, Type.Literal("animation"), Type.Literal("cycle")]),
          peak: Type.Optional(PlanNumberSchema),
          stagger: Type.Optional(PlanNumberSchema),
        },
        strict,
      ),
      { maxItems: 64 },
    ),
  ),
};

/**
 * Motion blocks. One main cycle of `cycle` frames is repeated `frames / cycle` times: a `settle`
 * cycle (anticipation, sink, hold, rise) or a symmetric `breath` (rest, one extreme, rest); everything else is posed on its beats, derived from its depth, or timed
 * by follow/cycle rules. Numbers may reference `params`, which the optimizer searches.
 */
export const MotionPlanSchema = Type.Object(
  {
    cycle: Type.Integer({ minimum: 4, maximum: 3600 }),
    fps: Type.Optional(Type.Integer({ minimum: 1, maximum: 60 })),
    params: Type.Record(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }), Type.Number()),
    search: Type.Optional(Type.Record(Type.String(), SearchRangeSchema)),
    animations: Type.Array(
      Type.Object(
        {
          name: NameSchema,
          frames: Type.Integer({ minimum: 4, maximum: 3600 }),
          /**
           * One-shot animation (ADR-030): false for an entry, exit, win or transition. Its keys need
           * not meet at the ends: swaps and keyed colours hold their last value, the main motion
           * returns to rest on the last frame, periods need not divide it, and the comparison skips
           * the loop seam. Default true (a loop).
           */
          loop: Type.Optional(Type.Boolean()),
          /**
           * This animation's own motion blocks (ADR-031), over the plan's: one character plan can
           * hold loops and one-shots that move differently. `params` merge over the plan's.
           */
          motion: Type.Optional(
            Type.Partial(
              Type.Object(
                {
                  cycle: Type.Integer({ minimum: 4, maximum: 3600 }),
                  params: Type.Record(
                    Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }),
                    Type.Number(),
                  ),
                  ...motionBlocks,
                },
                strict,
              ),
            ),
          ),
          /** Anticipation scale per cycle (cycle 1 first; a breath scales its depth); default 1. */
          cycleScale: Type.Optional(Type.Array(PlanNumberSchema, { maxItems: 64 })),
          /**
           * Part sets (ADR-021): slots shown for the whole animation (a slot's setup attachment,
           * else its only one, or `slot#attachment`) and slots hidden, e.g. a pose set that is
           * hidden in setup replacing the setup set.
           */
          show: Type.Optional(Type.Array(PartNameSchema, { maxItems: 512 })),
          hide: Type.Optional(Type.Array(PartNameSchema, { maxItems: 512 })),
          /**
           * Rest pose (ADR-024): per-bone offsets added to every key for the whole animation, for a
           * setup that is a layout of several poses. x, y in the parent's frame (y down); rotate in
           * degrees, clockwise on screen. `fit-pose` measures them from a reference image.
           */
          pose: Type.Optional(
            Type.Record(
              IdSchema,
              Type.Object(
                {
                  x: Type.Optional(Type.Number()),
                  y: Type.Optional(Type.Number()),
                  rotate: Type.Optional(Type.Number()),
                },
                strict,
              ),
            ),
          ),
          /**
           * Key poses (ADR-033): a pose layer keyed on frames, eased between them and added to every
           * bone timeline like a `pose` that changes over time, so the plan's follows and waves stay
           * on top. A bone missing from a key has no offset there. Frame 0 has no offset unless a
           * key sits there; a one-shot holds its last key, a loop returns to frame 0. `fit-pose`
           * measures them from reference pictures (storyboard or video frames).
           */
          keyposes: Type.Optional(
            Type.Array(
              Type.Object(
                {
                  frame: Type.Integer({ minimum: 0, maximum: 3600 }),
                  /** Arrival ease; default "ease". */
                  ease: Type.Optional(KeyposeEaseSchema),
                  pose: Type.Record(
                    IdSchema,
                    Type.Object(
                      {
                        x: Type.Optional(Type.Number()),
                        y: Type.Optional(Type.Number()),
                        rotate: Type.Optional(Type.Number()),
                      },
                      strict,
                    ),
                  ),
                },
                strict,
              ),
              { minItems: 1, maxItems: 256 },
            ),
          ),
        },
        strict,
      ),
      { minItems: 1, maxItems: 64 },
    ),
    ...motionBlocks,
    /**
     * Explicit keys per animation (props, light sweeps); merged into the main beats by frame.
     * With `move`, each key is a saccade (eye looks): hold the previous value until `frame`, arrive
     * at `value` `move` frames later with the key's ease; a loop that ends away from `rest` gets a
     * closing move back to it.
     */
    keyed: Type.Optional(
      Type.Array(
        Type.Object(
          {
            ...control,
            rest: PlanValueSchema,
            move: Type.Optional(PlanNumberSchema),
            keys: Type.Record(
              NameSchema,
              Type.Array(
                Type.Object(
                  {
                    frame: Type.Integer({ minimum: 0, maximum: 3600 }),
                    value: PlanValueSchema,
                    /** Arrival ease; default the beat's (a look arrives with "out"). */
                    ease: Type.Optional(KeyposeEaseSchema),
                  },
                  strict,
                ),
                { minItems: 1, maxItems: 256 },
              ),
            ),
          },
          strict,
        ),
        { maxItems: 128 },
      ),
    ),
    /**
     * Attachment swaps inside an animation (ADR-027): blinks, mouth shapes, flash frames. Per
     * animation, `{ frame, attachment }` keys (an attachment of the slot, or null to hide). Before
     * the first key the slot keeps its part-set or setup attachment, and the loop closes on the
     * frame-0 attachment; a swapped slot is not also held by that animation's `show` / `hide`.
     */
    swaps: Type.Optional(
      Type.Array(
        Type.Object(
          {
            slot: PartNameSchema,
            keys: Type.Record(
              NameSchema,
              Type.Array(
                Type.Object(
                  {
                    frame: Type.Integer({ minimum: 0, maximum: 3600 }),
                    attachment: Type.Union([NameSchema, Type.Null()]),
                  },
                  strict,
                ),
                { minItems: 1, maxItems: 256 },
              ),
            ),
          },
          strict,
        ),
        { maxItems: 128 },
      ),
    ),
    /**
     * Explicit slot colour keys per animation (flashes, fades, tints). `alpha` multiplies the setup
     * alpha, `color` replaces the RGB; a key's ease shapes the segment arriving at it. Frame 0
     * defaults to the setup colour and the loop closes on the first key.
     */
    colors: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: IdSchema,
            slots: Type.Array(PartNameSchema, { minItems: 1, maxItems: 64 }),
            keys: Type.Record(
              NameSchema,
              Type.Array(
                Type.Object(
                  {
                    frame: Type.Integer({ minimum: 0, maximum: 3600 }),
                    alpha: Type.Optional(PlanNumberSchema),
                    color: Type.Optional(Type.String({ pattern: "^[0-9a-fA-F]{6}$" })),
                    ease: Type.Optional(KeyposeEaseSchema),
                  },
                  strict,
                ),
                { minItems: 1, maxItems: 256 },
              ),
            ),
          },
          strict,
        ),
        { maxItems: 64 },
      ),
    ),
  },
  strict,
);

export const CharacterPlanSchema = Type.Object(
  {
    schemaVersion: SchemaVersionSchema,
    kind: Type.Literal("character-plan"),
    id: IdSchema,
    name: NameSchema,
    /** Paths relative to the plan file; the CLI resolves and reads them. */
    source: Type.Object(
      { imagesOnly: Type.String({ minLength: 1 }), images: Type.String({ minLength: 1 }) },
      strict,
    ),
    /** The art's tilt, used by bones with angle "art" (face controls). */
    artAngle: Type.Optional(Type.Number({ minimum: -180, maximum: 180 })),
    joints: Type.Record(IdSchema, JointRuleSchema),
    bones: Type.Array(
      Type.Union([BonePlanSchema, Type.Object({ chain: ChainPlanSchema }, strict)]),
      {
        minItems: 1,
        maxItems: 1024,
      },
    ),
    face: Type.Optional(FacePlanSchema),
    meshes: Type.Optional(Type.Array(MeshPlanSchema, { maxItems: 512 })),
    /** Region attachments rigid to a bone; sheared placements become rigid quads automatically. */
    regions: Type.Optional(Type.Record(PartNameSchema, IdSchema)),
    /**
     * ADR-024. `all`: every region part an animation shows (all of them when no animation has
     * `show`) is meshed at artist density and weighted rigidly to its region bone. Collapsed and
     * sheared placements keep their region or quad.
     */
    meshing: Type.Optional(Type.Object({ all: Type.Optional(Type.Boolean()) }, strict)),
    constraints: Type.Optional(
      Type.Object(
        {
          ik: Type.Optional(Type.Array(IkPlanSchema, { maxItems: 64 })),
          transform: Type.Optional(Type.Array(TransformPlanSchema, { maxItems: 64 })),
        },
        strict,
      ),
    ),
    motion: MotionPlanSchema,
    /** Quality checks: seams, performance probes and the parts deformation QA ignores. */
    qa: Type.Optional(
      Type.Object(
        {
          /** Mesh pairs measured with the engine's overlap QA at one time per animation (default: half way). */
          seams: Type.Optional(
            Type.Array(Type.Tuple([PartNameSchema, PartNameSchema]), { maxItems: 64 }),
          ),
          at: Type.Optional(Type.Record(NameSchema, Type.Number({ minimum: 0 }))),
          /** Parts sampled for the performance critic (centroids), by probe role. */
          probes: Type.Optional(
            Type.Object(
              {
                face: Type.Optional(PartNameSchema),
                eyes: Type.Optional(PartNameSchema),
                pupils: Type.Optional(PartNameSchema),
                /** Delay chain, root first: [probe name, part]. */
                chain: Type.Optional(
                  Type.Array(Type.Tuple([IdSchema, PartNameSchema]), { minItems: 1, maxItems: 16 }),
                ),
                hand: Type.Optional(Type.Tuple([IdSchema, PartNameSchema])),
              },
              strict,
            ),
          ),
          /** Regular expressions of part names left out of character deformation QA (FX, glow, props). */
          deformExclude: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 64 }),
          ),
          /** Comparison sheet crop in Spine world units (y up): top-left and size. */
          view: Type.Optional(
            Type.Object(
              {
                x: Type.Number(),
                y: Type.Number(),
                width: Type.Number({ exclusiveMinimum: 0 }),
                height: Type.Number({ exclusiveMinimum: 0 }),
                scale: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 8 })),
              },
              strict,
            ),
          ),
        },
        strict,
      ),
    ),
    output: Type.Optional(
      Type.Object({ imagesPath: Type.Optional(Type.String({ minLength: 1 })) }, strict),
    ),
  },
  { $id: "CharacterPlan-0.1", ...strict },
);

export type PlanNumber = Static<typeof PlanNumberSchema>;
export type PlanValue = Static<typeof PlanValueSchema>;
export type JointRule = Static<typeof JointRuleSchema>;
export type JointRef = Static<typeof JointRefSchema>;
export type BonePlan = Static<typeof BonePlanSchema>;
export type ChainPlan = Static<typeof ChainPlanSchema>;
export type MeshPlan = Static<typeof MeshPlanSchema>;
export type FacePlan = Static<typeof FacePlanSchema>;
export type IkPlan = Static<typeof IkPlanSchema>;
export type TransformPlan = Static<typeof TransformPlanSchema>;
export type MotionPlan = Static<typeof MotionPlanSchema>;
export type CharacterPlan = Static<typeof CharacterPlanSchema>;
export type SearchRange = Static<typeof SearchRangeSchema>;
