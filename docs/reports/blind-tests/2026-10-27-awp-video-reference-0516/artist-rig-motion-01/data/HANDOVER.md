# Artist binding + MOV-authored motion

135 human-authored bones and the original static mesh/weights retained by explicit request. All original animations and events were removed before authoring. Only Idel_02 was newly animated from MOV; this is not auto-rigging and not an untouched blind test.

Main motion: forward/backward video fit every six frames; uncertain observations interpolated and listed in the tracking record. Mouth: Mouth_01, bone29 muzzle control and bone23 jaw. Eyes: complete eye group and closed-lid fades. No source animation keys or deform curves reused.

The character-plan in checks is a render/delivery adapter only. Do not run build-character on it: doing so would replace the artist binding. Continue from plans/plan-07.json and apply-rig-motion.

Motion-only refinement: face control limited to ±35/20 local units and ear gain 0.7 after visible inversion review. Main tracked layer advanced three frames from fresh video comparison; expression events were not shifted. These are case-specific settings.
