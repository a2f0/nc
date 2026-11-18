import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

test("lint entrypoints select the same checkout from the matrix and the checkout", () => {
  const matrix = realpathSync(mkdtempSync(join(tmpdir(), "nc lint matrix ")));
  const checkout = join(matrix, "checkouts", "noise checkout"), bin = join(matrix, "bin");
  const env = { HOME: matrix, PATH: bin + ":" + process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  try {
    mkdirSync(checkout, { recursive: true });
    mkdirSync(bin);
    for (const dir of [matrix, checkout]) execFileSync("git", ["init", "--quiet", dir], { env });
    cpSync(resolve(import.meta.dir, "../checks"), join(checkout, "scripts/checks"), { recursive: true });
    writeFileSync(join(matrix, "outer.sh"), "");
    execFileSync("git", ["add", "outer.sh"], { cwd: matrix, env });
    writeFileSync(join(checkout, "tracked source.kt"), "");
    execFileSync("git", ["add", "tracked source.kt"], { cwd: checkout, env });
    writeFileSync(join(checkout, "local.kts"), "");
    writeFileSync(join(checkout, "local shell.sh"), "");
    writeFileSync(join(checkout, ".gitignore"), "ignored.*\n");
    for (const file of ["ignored.sh", "ignored.kt"]) writeFileSync(join(checkout, file), "");
    for (const tool of ["shellcheck", "ktlint", "swiftformat", "swiftlint"]) {
      writeFileSync(join(bin, tool), `#!/bin/sh\nprintf '%s\\n' "${tool}" "$(pwd -P)" "$@"\n`, { mode: 0o755 });
    }
    const invoke = (cwd: string, script: string, ...args: string[]) =>
      spawnSync("./" + relative(cwd, join(checkout, "scripts/checks", script)), args, {
        cwd, encoding: "utf8", env: { ...env, GIT_DIR: join(matrix, ".git"), GIT_WORK_TREE: matrix, GIT_INDEX_FILE: join(matrix, ".git/index") },
      });
    for (const cwd of [matrix, checkout]) {
      const shell = invoke(cwd, "lintScripts.sh");
      expect(shell.status).toBe(0);
      const files = shell.stdout.trimEnd().split("\n");
      expect(files.slice(0, 3)).toEqual(["shellcheck", checkout, "-x"]);
      expect(files).toContain("local shell.sh");
      expect(files).not.toContain("outer.sh");
      expect(files).not.toContain("ignored.sh");
      for (const args of [[], ["--format"]]) {
        const kotlin = invoke(cwd, "lintKotlin.sh", ...args);
        expect(kotlin.status).toBe(0);
        const lines = kotlin.stdout.trimEnd().split("\n"), flags = ["ktlint", checkout, "--relative", ...args];
        expect(lines.slice(0, flags.length)).toEqual(flags);
        expect(lines.slice(flags.length).sort()).toEqual(["local.kts", "tracked source.kt"]);
        const swift = invoke(cwd, "lintSwift.sh", ...args);
        expect(swift.status).toBe(0);
        const format = args.length ? ["swiftformat", checkout, "--quiet", "ios", "swiftlint", checkout, "lint", "--fix", "--quiet"] : [];
        expect(swift.stdout.trimEnd().split("\n")).toEqual([...format, "swiftformat", checkout, "--lint", "--quiet", "ios", "swiftlint", checkout, "lint", "--strict", "--quiet"]);
      }
    }
    rmSync(join(checkout, ".git"), { recursive: true });
    for (const script of ["lintScripts.sh", "lintKotlin.sh"]) {
      const misplaced = invoke(matrix, script);
      expect(misplaced.status).not.toBe(0);
      expect(misplaced.stderr).toContain("Lint requires its own Git checkout.");
      expect(misplaced.stdout).toBe("");
    }
  } finally {
    rmSync(matrix, { recursive: true, force: true });
  }
});
