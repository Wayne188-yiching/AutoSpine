<!-- Generated from skills/autospine/references/existing-rig-motion.md by tools/build-plugin.mjs. Edit the source, then rebuild. -->

# Animate an existing artist binding

Use this route only when the requester explicitly authorizes retaining the supplied bones, meshes,
weights and setup constraints. It measures motion generation separately from rig generation. Label
the result **artist binding + reference-video motion**, not automatic rigging or an untouched blind test.

1. Work on a copy. `prepare-rig source.json new-rig.json` keeps the Spine 4.0 static binding and
   clears every animation and event definition without reading their contents. It also resets the
   image path to `./images/`. If the input is already an unanimated rig, the same command validates it.
2. Inspect that rig's controls, rest pose, weighted influences and available image sets. A weighted
   slot's parent bone can be the root even when its mesh follows other bones. Do not infer ownership
   from the slot parent alone. `fitRestPose` in the reference API accepts `owners: { slot: controlBone }`
   alongside the explicit free `bones` and `translate` controls. Unobserved/ambiguous parts stay unclaimed.
   Discover the actual root and control names; an artist root need not be named `root`. With IK,
   match the wrist/elbow target rather than rotating a constrained arm bone that the solver resets.
   For rigs containing several construction stages or expressions, establish the visible image set
   from the reference before tracking. A setup pose can display pieces from several stages at once.
   Do not hide mismatched side pieces merely to improve a fit score; record unresolved assembly errors.
3. Author new tracks from the supplied video or storyboard. Choose expression images by their shape
   and coverage in the reference, then test the existing muzzle, jaw and lid controls. Keep the whole
   eye group consistent, and inspect the opening/closing transitions as well as the extreme pose.
   Source animation keys, deform curves, timing and events must not enter this step unless separately
   authorized. A static rig by itself does not supply the intended motion.
   Check appearance events as well as joints: glowing eyes, effect sprite changes and bloom can move
   the measured silhouette even when body parts track well. Reconstruct their timing from the video;
   do not amplify body motion to compensate for missing effects.
4. Save the **newly authored** native Spine 4.0 animation object as its own versioned motion file:

   ```json
   {
     "NewIdle": {
       "bones": {
         "body": {
           "rotate": [
             { "time": 0, "value": 0 },
             { "time": 1, "value": 2 },
             { "time": 2, "value": 0 }
           ]
         }
       }
     }
   }
   ```

   Times are seconds and bone values are offsets from the retained setup. Replace `body` with a
   verified control. This is a format example, not an idle recipe or a video inference result.

5. `apply-rig-motion new-rig.json motion.json new-result.json` refuses an input with existing
   animations and checks references before writing a new file. It preserves the static binding and
   reports `bindingUnchanged`. It applies supplied tracks; it does not extract motion from a video.
6. Play the result, compare it against the video and check visible mesh folds and attachment seams.
   Inspect the official Spine import/export separately from runtime rendering. Static binding
   equality and numeric checks are not visual acceptance. Report any timing/shape discrepancies.
   Check visible triangle inversions separately from whole-part collapse/flip rows: a mouth can
   fold locally while the whole-part row passes. Keep safe control limits specific to the rig and
   report any resulting loss of mouth-opening range rather than treating it as a complete match.
   A nearly stationary clip with changing glow cannot validate body timing: identify that measurement
   as unjudged and inspect brightness separately. Do not count an unjudged row as a successful check.

Do not run `build-character` to preserve an existing binding: that command rebuilds the rig from an
images-only plan. A render/delivery adapter plan must be labelled as such and must not be used to
rebuild this output. Continue from the sanitized rig and versioned new motion file instead.

These steps do not require per-animation MOV exports, quarantine folders or benchmark reports in
production. Use the animation references the requester supplies; test-only preparation stays separate.
