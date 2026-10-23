import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../..");

test.each([
  ["scoped header", "feat(ios): add sleep timer\n", true],
  ["leading comments and blanks", "# template\n\nfeat: add timer\n", true],
  ["uppercase scope", "feat(IOS): add timer\n", false],
  ["uppercase subject", "feat: Add timer\n", false],
  ["terminal period", "feat: add timer.\n", false],
  ["whole header length", `feat: ${"a".repeat(40)} (#123)\n`, false],
  ["generated message", `Merge branch ${"a".repeat(60)}\n`, true],
  ["generated lookalike", "Mergeable message\n", false],
  ["coauthor trailer", "feat: add timer\n\nCo-authored-by: Example <example@example.com>\n", false],
] as const)("commit adapter: %s", (_name, message, accepted) => {
  const directory = mkdtempSync(join(tmpdir(), "nc-commit-message-"));
  try {
    writeFileSync(join(directory, "message"), message);
    // Relative input from outside the checkout also exercises path handling.
    const result = spawnSync("sh", [join(root, "scripts/checks/lintCommitMessage.sh"), "message"], {
      cwd: directory,
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.status === 0).toBe(accepted);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pre-commit permits a detached rebase commit", () => {
  const directory = mkdtempSync(join(tmpdir(), "nc-detached-hook-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    expect(result.status).toBe(0);
    return result.stdout.trim();
  };
  try {
    git("init", "--quiet");
    git("config", "user.name", "Hook fixture");
    git("config", "user.email", "fixture@example.com");
    const tree = git("mktree");
    const commit = git("commit-tree", tree, "-m", "chore: fixture");
    git("update-ref", "--no-deref", "HEAD", commit);
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: {
      "lint:branch-name": "agent-tool branch check",
      "lint:binary-files": "agent-tool checks binaries",
    } }));
    writeFileSync(join(directory, "agent-tool.json"), JSON.stringify({
      schemaVersion: 1, branch: { enforce: true }, binaries: { allow: [] },
    }));
    const result = spawnSync("sh", [join(root, "scripts/git/hooks/pre-commit")], {
      cwd: directory, encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
