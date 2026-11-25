import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AUTOSPINE_VERSION } from "@autospine/cli/version";
import { chooseWorkspace, mcpTools } from "@autospine/mcp";
import { fixtureWorkspace } from "./character-fixture.js";

const plugin = resolve("plugin");
const skill = join(plugin, "skills", "autospine");
const json = async (path: string) =>
  JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

/** The bundled engine copied away from the repository, so nothing resolves from node_modules. */
async function isolatedEngine() {
  const dir = await mkdtemp(join(tmpdir(), "autospine-plugin-engine-"));
  await cp(join(skill, "scripts"), join(dir, "scripts"), { recursive: true });
  return {
    dir,
    cli: (cwd: string, ...args: string[]) =>
      spawnSync(process.execPath, [join(dir, "scripts", "autospine.mjs"), ...args], {
        cwd,
        encoding: "utf8",
        timeout: 120_000,
      }),
    mcp: join(dir, "scripts", "autospine-mcp.mjs"),
  };
}

describe("MCP workspace choice", () => {
  it("prefers AUTOSPINE_WORKSPACE, then --workspace (with ~), then the working directory", () => {
    const home = resolve("/home/someone"),
      cwd = resolve("/work");
    expect(
      chooseWorkspace({ AUTOSPINE_WORKSPACE: "/env/ws" }, ["--workspace=~/AutoSpine"], cwd, home),
    ).toEqual({ path: resolve("/env/ws"), source: "env" });
    expect(chooseWorkspace({}, ["--workspace=~/AutoSpine"], cwd, home)).toEqual({
      path: join(home, "AutoSpine"),
      source: "argument",
    });
    expect(chooseWorkspace({}, ["--workspace=~"], cwd, home).path).toBe(home);
    expect(chooseWorkspace({ AUTOSPINE_WORKSPACE: "  " }, ["--workspace=jobs"], cwd, home)).toEqual(
      { path: join(cwd, "jobs"), source: "argument" },
    );
    expect(chooseWorkspace({}, [], cwd, home)).toEqual({ path: cwd, source: "cwd" });
  });
});

describe("advertised MCP tool schemas", () => {
  // Claude Code drops a tool whose schema the Anthropic API would reject (JSON Schema 2020-12):
  // tuples must be `prefixItems`, never an array-valued `items` or `additionalItems`.
  it("use 2020-12 tuples, so Claude Code keeps every tool", () => {
    const problems: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}/${i}`));
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (Array.isArray(record.items)) problems.push(`${path}/items is an array`);
      if ("additionalItems" in record) problems.push(`${path}/additionalItems`);
      for (const [key, value] of Object.entries(record)) walk(value, `${path}/${key}`);
    };
    for (const tool of mcpTools) walk(tool.inputSchema, tool.name);
    expect(problems).toEqual([]);
    const featureMesh = JSON.stringify(mcpTools.find((t) => t.name === "autospine_feature_mesh"));
    expect(featureMesh).toContain('"prefixItems"');
  });
});

describe("plugin package (Claude and Codex)", () => {
  it("is generated from the current build", () => {
    const run = spawnSync(process.execPath, ["tools/build-plugin.mjs", "--check"], {
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  }, 150_000);

  it("declares one plugin, its skill and its MCP server for both hosts", async () => {
    const claude = await json(join(plugin, ".claude-plugin", "plugin.json"));
    const codex = await json(join(plugin, ".codex-plugin", "plugin.json"));
    expect(claude.name).toBe("autospine");
    // The engine reports the plugin's version (command line, MCP server, build records).
    expect(AUTOSPINE_VERSION).toBe(claude.version);
    expect(codex).toMatchObject({
      name: "autospine",
      version: claude.version,
      skills: "./skills/",
      mcpServers: "./.codex-mcp.json",
    });
    const skillText = await readFile(join(skill, "SKILL.md"), "utf8");
    expect(skillText).toMatch(/^---\nname: autospine\ndescription: .+\n---\n/);

    const claudeMcp = (await json(join(plugin, ".mcp.json"))) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const codexMcp = (await json(join(plugin, ".codex-mcp.json"))) as {
      mcpServers: Record<string, { command: string; args: string[]; cwd: string }>;
    };
    // resolve() normalises the separators: the config writes "/" and Windows paths use "\".
    const fromClaude = resolve(
      claudeMcp.mcpServers.autospine!.args[0]!.replace("${CLAUDE_PLUGIN_ROOT}", plugin),
    );
    const fromCodex = resolve(
      plugin,
      codexMcp.mcpServers.autospine!.cwd,
      codexMcp.mcpServers.autospine!.args[0]!,
    );
    expect(fromClaude).toBe(join(skill, "scripts", "autospine-mcp.mjs"));
    expect(fromCodex).toBe(fromClaude);
    for (const server of [claudeMcp.mcpServers.autospine!, codexMcp.mcpServers.autospine!])
      expect(server).toMatchObject({ command: "node" });
    expect(claudeMcp.mcpServers.autospine!.args).toContain("--workspace=~/AutoSpine");
    expect(codexMcp.mcpServers.autospine!.args).toContain("--workspace=~/AutoSpine");

    const claudeMarket = (await json(resolve(".claude-plugin", "marketplace.json"))) as {
      plugins: { name: string; source: string; version: string }[];
    };
    const codexMarket = (await json(resolve(".agents", "plugins", "marketplace.json"))) as {
      plugins: { name: string; source: { source: string; path: string } }[];
    };
    expect(claudeMarket.plugins).toEqual([
      expect.objectContaining({ name: "autospine", source: "./plugin", version: claude.version }),
    ]);
    expect(codexMarket.plugins).toEqual([
      expect.objectContaining({ name: "autospine", source: { source: "local", path: "./plugin" } }),
    ]);
    // Claude and Cowork refuse a plugin with a top-level bin/ directory.
    await expect(stat(join(plugin, "bin"))).rejects.toThrow();
  });

  it("links only to files inside the skill or to absolute URLs", async () => {
    const files = [
      "SKILL.md",
      ...(await readdir(join(skill, "references"), { recursive: true }))
        .map(String)
        .filter((f) => f.endsWith(".md"))
        .map((f) => join("references", f)),
    ];
    for (const file of files) {
      const text = await readFile(join(skill, file), "utf8");
      for (const [, href] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^[a-z]+:/i.test(href!) || href!.startsWith("#")) continue;
        const target = resolve(skill, file, "..", href!.split("#")[0]!);
        await expect(stat(target), `${file} → ${href}`).resolves.toBeTruthy();
      }
    }
  });

  it("runs the example character with the bundled engine and no node_modules", async () => {
    const engine = await isolatedEngine();
    const job = await mkdtemp(join(tmpdir(), "autospine-plugin-job-"));
    await cp(join(skill, "assets", "example"), job, { recursive: true });
    expect(engine.cli(job, "--version").stdout.trim()).toBe(AUTOSPINE_VERSION);
    expect(engine.cli(job, "lint-plan", "plan.json").status).toBe(0);
    const built = engine.cli(job, "build-character", "plan.json", "build");
    expect(built.status).toBe(0);
    expect(JSON.parse(built.stdout)).toMatchObject({
      bones: 20,
      slots: 7,
      engineVersion: AUTOSPINE_VERSION,
    });

    // Same output as the repository build of the same plan.
    const reference = await fixtureWorkspace();
    const repo = spawnSync(
      process.execPath,
      [resolve("packages/cli/dist/index.js"), "build-character", "plan.json", "build"],
      { cwd: reference, encoding: "utf8", timeout: 120_000 },
    );
    expect(repo.status).toBe(0);
    expect(await readFile(join(job, "build", "fixture_character.json"), "utf8")).toBe(
      await readFile(join(reference, "build", "fixture_character.json"), "utf8"),
    );

    // The comparison loads the official runtime shipped beside the engine.
    const compared = engine.cli(
      job,
      "compare-reference",
      "plan.json",
      "build",
      "build/fixture_character.json",
      "compare",
    );
    expect(compared.status).toBe(0);
    expect(compared.stdout).toContain("ALL AUTOMATABLE CRITERIA PASS");
  }, 300_000);

  it("starts the bundled MCP server on ~/AutoSpine and lints a plan there", async () => {
    const engine = await isolatedEngine();
    const home = await mkdtemp(join(tmpdir(), "autospine-plugin-home-"));
    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
    };
    delete env.AUTOSPINE_WORKSPACE;
    const workspace = join(home, "AutoSpine");
    const lines = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "plugin-test", version: "1" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "autospine_get_status", arguments: {} },
      },
    ];
    const run = spawnSync(process.execPath, [engine.mcp, "--workspace=~/AutoSpine"], {
      cwd: engine.dir,
      env,
      input: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.stderr).toBe("");
    const replies = run.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { id: number; result: Record<string, unknown> });
    // The version a stale server would report differently from the command line.
    expect(replies.find((r) => r.id === 1)!.result.serverInfo).toEqual({
      name: "autospine",
      version: AUTOSPINE_VERSION,
    });
    const tools = replies.find((r) => r.id === 2)!.result.tools as { name: string }[];
    expect(tools.map((t) => t.name).sort()).toEqual(mcpTools.map((t) => t.name).sort());
    const status = replies.find((r) => r.id === 3)!.result.structuredContent as {
      version: string;
      workspace: string;
    };
    expect(status.version).toBe(AUTOSPINE_VERSION);
    expect(status.workspace).toBe(workspace);
    // The repository's development gates are not part of a plugin workspace.
    expect(status).not.toHaveProperty("status");
    expect((await stat(workspace)).isDirectory()).toBe(true);

    await cp(join(skill, "assets", "example"), join(workspace, "example"), { recursive: true });
    const build = spawnSync(process.execPath, [engine.mcp, "--workspace=~/AutoSpine"], {
      cwd: engine.dir,
      env,
      input:
        [
          lines[0],
          lines[1],
          {
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: {
              name: "autospine_build_character",
              arguments: { planPath: "example/plan.json", outputDir: "example/build" },
            },
          },
        ]
          .map((l) => JSON.stringify(l))
          .join("\n") + "\n",
      encoding: "utf8",
      timeout: 120_000,
    });
    const reply = build.stdout
      .trim()
      .split("\n")
      .map(
        (l) =>
          JSON.parse(l) as {
            id: number;
            result: { isError?: boolean; structuredContent: Record<string, unknown> };
          },
      )
      .find((r) => r.id === 4)!;
    expect(reply.result.isError).not.toBe(true);
    expect(reply.result.structuredContent).toMatchObject({ bones: 20 });
    await expect(
      stat(join(workspace, "example", "build", "fixture_character.json")),
    ).resolves.toBeTruthy();
  }, 120_000);
});

describe("plugin subagents (ADR-055)", () => {
  const agentsDir = join(plugin, "agents");
  const frontmatter = (text: string) => {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, "\n"));
    if (!match) throw new Error("no frontmatter");
    return Object.fromEntries(
      match[1]!.split("\n").map((line) => {
        const at = line.indexOf(":");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
    ) as Record<string, string>;
  };
  const expected: Record<string, string> = {
    "autospine-intake": "haiku",
    "autospine-reference-scout": "haiku",
    "autospine-build-qa": "sonnet",
    "autospine-visual-reviewer": "opus",
    "autospine-codex-reviewer": "haiku",
  };

  it("define each agent with its model and tools, and the skill names them all", async () => {
    const files = (await readdir(agentsDir)).filter((f) => f.endsWith(".md")).sort();
    expect(files).toEqual(
      Object.keys(expected)
        .map((n) => `${n}.md`)
        .sort(),
    );
    const skillText = await readFile(join(skill, "SKILL.md"), "utf8");
    for (const file of files) {
      const meta = frontmatter(await readFile(join(agentsDir, file), "utf8"));
      const name = file.replace(/\.md$/, "");
      expect(meta.name).toBe(name);
      expect(meta.description!.length).toBeGreaterThan(40);
      expect(meta.model).toBe(expected[name]);
      const tools = meta.tools!.split(",").map((t) => t.trim());
      expect(tools.length).toBeGreaterThan(0);
      // Only the main session edits plans: build/QA and the reviewers report.
      expect(tools.filter((t) => ["Edit", "Write", "NotebookEdit"].includes(t))).toEqual([]);
      expect(skillText).toContain(`\`${name}\``);
    }
  });

  it("find Codex and always run it read-only and unsaved", async () => {
    const script = join(skill, "delegate", "codex-review.mjs");
    const codex = (await import(pathToFileURL(script).href)) as {
      findCodex: (o: Record<string, unknown>) => string | null;
      parseArgs: (argv: string[], env?: Record<string, string>) => Record<string, unknown>;
      codexArgs: (opts: Record<string, unknown>, file: string) => string[];
    };
    const files = new Set([
      join("/set", "codex.exe"),
      join("/path-b", "codex.exe"),
      join("/la", "OpenAI", "Codex", "bin", "old", "codex.exe"),
      join("/la", "OpenAI", "Codex", "bin", "new", "codex.exe"),
    ]);
    const base = {
      platform: "win32",
      exists: (f: string) => files.has(f),
      listDirs: () => ["old", "new", "empty"],
      mtime: (f: string) => (f.includes("new") ? 2 : 1),
    };
    const sep = process.platform === "win32" ? ";" : ":";
    expect(codex.findCodex({ ...base, env: { AUTOSPINE_CODEX: join("/set", "codex.exe") } })).toBe(
      resolve(join("/set", "codex.exe")),
    );
    expect(codex.findCodex({ ...base, env: { AUTOSPINE_CODEX: "/missing" } })).toBeNull();
    expect(
      codex.findCodex({ ...base, env: { PATH: `/path-a${sep}/path-b`, LOCALAPPDATA: "/la" } }),
    ).toBe(join("/path-b", "codex.exe"));
    expect(codex.findCodex({ ...base, env: { PATH: "", LOCALAPPDATA: "/la" } })).toBe(
      join("/la", "OpenAI", "Codex", "bin", "new", "codex.exe"),
    );
    expect(
      codex.findCodex({ ...base, platform: "linux", env: { PATH: "", LOCALAPPDATA: "/la" } }),
    ).toBeNull();

    const plain = codex.codexArgs(codex.parseArgs(["--cd=/p"], {}), "/tmp/last.md");
    expect(plain.slice(0, 5)).toEqual([
      "exec",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
    ]);
    expect(plain).not.toContain("--model");
    expect(plain.join(" ")).not.toContain("model_reasoning_effort");
    expect(plain.at(-1)).toBe("-");
    const full = codex.codexArgs(
      codex.parseArgs(["--cd=/p", "--image=/a.png", "--image=/b.png"], {
        AUTOSPINE_CODEX_MODEL: "m1",
        AUTOSPINE_CODEX_EFFORT: "low",
      }),
      "/tmp/last.md",
    );
    expect(full.join(" ")).toContain(
      "--model m1 --config model_reasoning_effort=low --image /a.png --image /b.png -",
    );
    expect(
      codex.parseArgs(["--cd=/p", "--effort=high", "--model=m2"], { AUTOSPINE_CODEX_MODEL: "m1" }),
    ).toMatchObject({ model: "m2", effort: "high" });
    expect(() => codex.parseArgs(["--cd=/p", "--effort=max"], {})).toThrow(/--effort/);
    expect(() => codex.parseArgs([], {})).toThrow(/--cd/);
    expect(() => codex.parseArgs(["--cd=/p", "--sandbox=danger-full-access"], {})).toThrow(
      /unknown/,
    );
  });
});
