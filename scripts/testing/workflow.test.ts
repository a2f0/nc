import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../..");
// Git hook environment variables must not point temporary fixtures at the real repo.
const fixtureEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

test.each([
  ["scoped header", "feat(ios): add sleep timer\n", true, "#"],
  ["leading comments and blanks", "# template\n\nfeat: add timer\n", true, "#"],
  ["uppercase scope", "feat(IOS): add timer\n", false, "#"],
  ["uppercase subject", "feat: Add timer\n", false, "#"],
  ["terminal period", "feat: add timer.\n", false, "#"],
  ["whole header length", `feat: ${"a".repeat(40)} (#123)\n`, false, "#"],
  ["generated message", `Merge branch ${"a".repeat(60)}\n`, true, "#"],
  ["generated lookalike", "Mergeable message\n", false, "#"],
  ["coauthor trailer", "feat: add timer\n\nCo-authored-by: Example <example@example.com>\n", false, "#"],
  ["verbose diff scissors", "feat: add timer\n# ------------------------ >8 ------------------------\n\nCo-authored-by: Example <example@example.com>\n", true, "#"],
  ["custom comment character", "; template\nfeat: add timer\n; ------------------------ >8 ------------------------\n\nCo-authored-by: Example <example@example.com>\n", true, ";"],
] as const)("commit adapter: %s", (_name, message, accepted, commentChar) => {
  const directory = mkdtempSync(join(tmpdir(), "nc-commit-message-"));
  try {
    writeFileSync(join(directory, "message"), message);
    // Relative input from outside the checkout also exercises path handling.
    const result = spawnSync("sh", [join(root, "scripts/checks/lintCommitMessage.sh"), "message"], {
      cwd: directory,
      encoding: "utf8",
      env: commentChar ? { ...fixtureEnv, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.commentChar", GIT_CONFIG_VALUE_0: commentChar } : fixtureEnv,
    });
    expect(result.error).toBeUndefined();
    expect(result.status === 0).toBe(accepted);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test.each([true, false])("pre-commit validates attached branches (detached=%s)", (detached) => {
  const directory = mkdtempSync(join(tmpdir(), "nc-detached-hook-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8", env: fixtureEnv });
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
    if (!detached) git("switch", "-c", "foo");
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: {
      "lint:branch-name": "agent-tool branch check",
      "lint:binary-files": "agent-tool checks binaries",
    } }));
    writeFileSync(join(directory, "agent-tool.json"), JSON.stringify({
      schemaVersion: 1, branch: { enforce: true }, binaries: { allow: [] },
    }));
    const result = spawnSync("sh", [join(root, "scripts/git/hooks/pre-commit")], {
      cwd: directory, encoding: "utf8", env: fixtureEnv,
    });
    expect(result.error).toBeUndefined();
    expect(result.status === 0).toBe(detached);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pre-push checks unpublished commits for named and URL pushes", () => {
  const directory = mkdtempSync(join(tmpdir(), "nc-push-hook-"));
  const run = (command: string, args: string[], input?: string) => spawnSync(command, args, {
    cwd: directory, encoding: "utf8", env: fixtureEnv, input,
  });
  const git = (...args: string[]) => {
    const result = run("git", args);
    expect(result.status).toBe(0);
    return result.stdout.trim();
  };
  try {
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "Hook fixture");
    git("config", "user.email", "fixture@example.com");
    const remote = join(directory, "remote.git");
    git("remote", "add", "origin", remote);
    mkdirSync(join(directory, "scripts/git"), { recursive: true });
    cpSync(join(root, "scripts/git/hooks"), join(directory, "scripts/git/hooks"), { recursive: true });
    cpSync(join(root, "agent-tool.json"), join(directory, "agent-tool.json"));
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
    const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
    // Isolate the real ref checks; the full native gate runs separately.
    scripts.check = "true";
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts }));
    const tree = git("mktree");
    const base = git("commit-tree", tree, "-m", "historical base");
    const published = git("commit-tree", tree, "-p", base, "-m", "historical unsigned mainline");
    git("update-ref", "refs/heads/main", base);
    git("update-ref", "refs/remotes/origin/main", published);
    git("add", "scripts/git/hooks");
    expect(run(process.execPath, ["run", "--silent", "hooks:install"]).status).toBe(0);

    const key = join(directory, "fixture-key");
    expect(run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]).status).toBe(0);
    const signers = join(directory, "allowed-signers");
    writeFileSync(signers, `fixture@example.com ${readFileSync(`${key}.pub`, "utf8")}`);
    git("config", "gpg.format", "ssh");
    git("config", "user.signingkey", key);
    git("config", "gpg.ssh.allowedSignersFile", signers);
    const unsigned = git("commit-tree", tree, "-p", published, "-m", "chore: unsigned local change");
    const signed = git("commit-tree", "-S", tree, "-p", published, "-m", "chore: signed local change");
    const coauthored = git("commit-tree", "-S", tree, "-p", published, "-m", "chore: coauthored local change\n\nCo-authored-by: Example <example@example.com>");
    const zero = "0".repeat(40);
    const hook = join(directory, ".git/hooks/pre-push");
    const push = (local: string, tip: string, name = "origin", destination = "refs/heads/chore/example") =>
      run(hook, [name, remote], `refs/heads/chore/example ${local} ${destination} ${tip}\n`);
    for (const tip of [zero, base]) {
      expect(push(published, tip).status).toBe(0);
      expect(push(signed, tip).status).toBe(0);
      for (const [local, error] of [[unsigned, "Signature does not meet"], [coauthored, "Co-authored-by trailer is forbidden"]]) {
        const result = push(local!, tip);
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain(error!);
      }
    }
    for (const tip of [zero, published]) {
      for (const [local, error] of [[unsigned, "Signature does not meet"], [coauthored, "Co-authored-by trailer is forbidden"]]) {
        const result = push(local!, tip, remote);
        expect(result.status).not.toBe(0);
        expect(result.stdout).toContain(error!);
      }
    }
    expect(push(published, base, "origin", "refs/heads/invalid-name").status).not.toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15_000);
