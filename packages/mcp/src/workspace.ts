import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface WorkspaceChoice {
  path: string;
  /** Where the path came from; a `--workspace` default is created when missing. */
  source: "env" | "argument" | "cwd";
}

/**
 * The workspace the stdio server guards. `AUTOSPINE_WORKSPACE` (set by a host or the user) wins,
 * then `--workspace=<path>` (the plugin passes `~/AutoSpine`; a leading `~` is the home folder),
 * then the working directory, as before.
 */
export function chooseWorkspace(
  env: Record<string, string | undefined>,
  argv: readonly string[],
  cwd: string,
  home: string = homedir(),
): WorkspaceChoice {
  const fromEnv = env.AUTOSPINE_WORKSPACE?.trim();
  if (fromEnv) return { path: resolve(cwd, fromEnv), source: "env" };
  const flag = argv.find((a) => a.startsWith("--workspace="));
  const value = flag?.slice("--workspace=".length).trim();
  if (value) {
    const expanded =
      value === "~" ? home : /^~[\\/]/.test(value) ? join(home, value.slice(2)) : value;
    return { path: resolve(cwd, expanded), source: "argument" };
  }
  return { path: resolve(cwd), source: "cwd" };
}
