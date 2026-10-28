import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { prepareRig, applyRigMotion } from "@autospine/reference";

const read = async (path: string) => JSON.parse(await readFile(path, "utf8")) as unknown;
const hash = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");

export async function prepareRigFile(input: string, output: string) {
  const document = prepareRig(await read(input));
  await writeFile(output, JSON.stringify(document, null, 2) + "\n", { flag: "wx" });
  return {
    output,
    animations: 0,
    bindingSha256: hash(document),
    note: "Static artist binding retained by explicit request; all animations and events removed.",
  };
}

export async function applyRigMotionFile(rigPath: string, motionPath: string, output: string) {
  const rig = await read(rigPath),
    motion = await read(motionPath);
  const document = applyRigMotion(rig, motion as Record<string, unknown>);
  await writeFile(output, JSON.stringify(document, null, 2) + "\n", { flag: "wx" });
  return {
    output,
    animations: Object.keys(document.animations as object),
    bindingUnchanged: hash(prepareRig(rig)) === hash(prepareRig(document)),
    bindingSha256: hash(prepareRig(document)),
  };
}
