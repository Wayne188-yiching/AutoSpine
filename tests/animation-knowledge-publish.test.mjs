import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishAnimationKnowledge } from "../tools/publish-animation-knowledge.mjs";

const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (root, ...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trim();

test("publishing preserves staged production work, is idempotent, and refuses stale references", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "autospine-publish-test-"));
  const remote = join(fixture, "remote.git");
  const root = join(fixture, "working");
  try {
    await mkdir(root);
    git(fixture, "init", "--bare", "--initial-branch=main", remote);
    git(root, "init", "--initial-branch=main");
    git(root, "config", "user.name", "Knowledge publish test");
    git(root, "config", "user.email", "publish-test@example.invalid");
    await mkdir(join(root, "knowledge/animation/runs"), { recursive: true });
    for (const name of ["catalog.json", "README.md", "CURATION.md", "index.html"])
      await writeFile(
        join(root, "knowledge/animation", name),
        await readFile(join(project, "knowledge/animation", name)),
      );
    await writeFile(join(root, "production.txt"), "committed production\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "Seed fixture");
    git(root, "remote", "add", "origin", remote);
    git(root, "push", "-u", "origin", "main");
    await writeFile(join(root, "production.txt"), "staged work in progress\n");
    git(root, "add", "production.txt");
    await writeFile(
      join(root, "knowledge/animation/runs/2026-10-30T00-00-00Z.json"),
      '{"result":"updated"}\n',
    );
    const originalHead = git(root, "rev-parse", "HEAD");
    const originalIndex = await readFile(join(root, ".git/index"));
    const options = { root, expectedRemote: remote };
    const preview = await publishAnimationKnowledge({ ...options, dryRun: true });
    assert.equal(preview.status, "dry-run");
    assert.ok(preview.changed.every((path) => path.startsWith("knowledge/animation/")));
    assert.equal(git(remote, "rev-parse", "main"), originalHead);
    const published = await publishAnimationKnowledge(options);
    assert.equal(published.status, "published");
    assert.equal(git(remote, "rev-parse", "main"), published.commit);
    assert.equal(git(remote, "show", "main:production.txt"), "committed production");
    assert.equal(git(root, "rev-parse", "HEAD"), originalHead);
    assert.deepEqual(await readFile(join(root, ".git/index")), originalIndex);
    assert.equal(await readFile(join(root, "production.txt"), "utf8"), "staged work in progress\n");
    const again = await publishAnimationKnowledge(options);
    assert.equal(again.status, "no-change");
    assert.equal(again.commit, published.commit);
    assert.deepEqual(again.changed, []);
    const receipt = JSON.parse(
      await readFile(join(root, ".git/autospine-animation-publish.json"), "utf8"),
    );
    assert.equal(receipt.commit, published.commit);
    const other = join(fixture, "other-editor");
    git(fixture, "clone", remote, other);
    git(other, "config", "user.name", "Other editor");
    git(other, "config", "user.email", "other-test@example.invalid");
    const catalogPath = join(other, "knowledge/animation/catalog.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
    catalog.entries[0].lastVerified = "2099-01-01T00:00:00Z";
    await writeFile(catalogPath, JSON.stringify(catalog));
    git(other, "add", "knowledge/animation/catalog.json");
    git(other, "commit", "-m", "Newer reference from another editor");
    git(other, "push", "origin", "main");
    const newerHead = git(remote, "rev-parse", "main");
    await assert.rejects(publishAnimationKnowledge(options), /missing or newer/);
    assert.equal(git(remote, "rev-parse", "main"), newerHead);
    assert.deepEqual(await readFile(join(root, ".git/index")), originalIndex);
    await assert.rejects(
      publishAnimationKnowledge({ ...options, expectedRemote: "https://example.invalid/other" }),
      /Origin differs/,
    );
  } finally {
    // Only remove the absolute temporary directory created by this test.
    assert.equal(dirname(fixture), resolve(tmpdir()));
    assert.ok(fixture.startsWith(join(resolve(tmpdir()), "autospine-publish-test-")));
    await rm(fixture, { recursive: true, force: true });
  }
});
