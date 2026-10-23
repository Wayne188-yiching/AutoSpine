type Json = Record<string, unknown>;
type Tree = Record<string, Record<string, Record<string, unknown>>>;

/**
 * A 4.0 skeleton laid out for a newer editor's import (ADR-046). From 4.1 deform keys live under
 * `animations.<a>.attachments.<skin>.<slot>.<attachment>.deform`; a 4.2 editor given the 4.0
 * `deform` imports the rest and drops every deform key. From 4.2 a bone's `transform` is
 * `inherit`. The rest of what AutoSpine writes reads the same in 4.1 and 4.2. Returns a copy; a
 * 4.0 version returns the document unchanged.
 */
export function forEditorVersion<T extends object>(document: T, version: string): T {
  const [major = 4, minor = 0] = version.split(".").map(Number);
  if (major === 4 && minor === 0) return document;
  const doc = structuredClone(document) as Json;
  doc.skeleton = {
    ...(doc.skeleton as Json),
    spine: version.split(".").length === 2 ? `${version}.0` : version,
  };
  for (const animation of Object.values((doc.animations ?? {}) as Record<string, Json>)) {
    const deform = animation.deform as Tree | undefined;
    if (!deform) continue;
    const moved: Record<string, Tree> = {};
    for (const [skin, slots] of Object.entries(deform))
      for (const [slot, attachments] of Object.entries(slots))
        for (const [name, keys] of Object.entries(attachments))
          ((moved[skin] ??= {})[slot] ??= {})[name] = { deform: keys };
    animation.attachments = moved;
    delete animation.deform;
  }
  if (major > 4 || minor >= 2)
    for (const bone of (doc.bones ?? []) as Json[])
      if (bone.transform !== undefined) {
        bone.inherit = bone.transform;
        delete bone.transform;
      }
  return doc as T;
}
