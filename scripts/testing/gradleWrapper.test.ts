import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { crc32 } from "node:zlib";

const script = resolve(import.meta.dir, "../dev/ensureGradleWrapper.sh");
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nc-gradle-wrapper-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// A complete zip holding one stored file, standing in for the wrapper jar.
function zip(): Buffer {
  const name = Buffer.from("a.txt");
  const data = Buffer.from("wrapper\n");
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(10, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(10, 4);
  central.writeUInt16LE(10, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]);
}

const jar = zip();
const failingCp = '/usr/bin/head -c 10 "$1" >"$2"; exit 1';

// The script in a stand-in repository, with a fake Gradle that writes the jar and a cp
// that either works or copies only the first ten bytes and fails, as an interrupted copy
// would. PATH holds only these and the system tools the script uses, by absolute path.
function setUp(cp: string) {
  const bin = join(root, "bin");
  const temp = join(root, "tmp");
  const repo = join(root, "repo");
  const wrapperDir = join(repo, "android/gradle/wrapper");
  for (const dir of [bin, temp, join(repo, "scripts/dev"), wrapperDir]) mkdirSync(dir, { recursive: true });
  copyFileSync(script, join(repo, "scripts/dev/ensureGradleWrapper.sh"));
  const source = join(root, "source.jar");
  writeFileSync(source, jar);
  const fakes = {
    gradle: `/bin/mkdir -p "$2/gradle/wrapper" && /bin/cp "${source}" "$2/gradle/wrapper/gradle-wrapper.jar"`,
    cp,
  };
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  for (const tool of ["dirname", "mktemp", "mv", "rm", "unzip"]) {
    const path = ["/usr/bin", "/bin"].map((dir) => join(dir, tool)).find(existsSync);
    if (!path) throw new Error(`${tool} not found`);
    symlinkSync(path, join(bin, tool));
  }
  const run = () => spawnSync("/bin/sh", [join(repo, "scripts/dev/ensureGradleWrapper.sh")], {
    encoding: "utf8",
    env: { PATH: bin, HOME: root, TMPDIR: temp },
  });
  return { run, wrapperDir, wrapperJar: join(wrapperDir, "gradle-wrapper.jar") };
}

test("a failed copy leaves no partial jar", () => {
  const { run, wrapperDir } = setUp(failingCp);
  const result = run();
  expect(result.status).not.toBe(0);
  expect(readdirSync(wrapperDir)).toEqual([]);
});

test("the generated jar is installed", () => {
  const { run, wrapperDir, wrapperJar } = setUp('/bin/cp "$@"');
  const result = run();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(readdirSync(wrapperDir)).toEqual(["gradle-wrapper.jar"]);
  expect(readFileSync(wrapperJar)).toEqual(jar);
});

test("a truncated jar is regenerated", () => {
  const { run, wrapperDir, wrapperJar } = setUp('/bin/cp "$@"');
  writeFileSync(wrapperJar, jar.subarray(0, 10));
  const result = run();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(readdirSync(wrapperDir)).toEqual(["gradle-wrapper.jar"]);
  expect(readFileSync(wrapperJar)).toEqual(jar);
});

test("a complete jar is kept without running Gradle", () => {
  const { run, wrapperJar } = setUp("exit 1");
  writeFileSync(wrapperJar, jar);
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("");
  expect(readFileSync(wrapperJar)).toEqual(jar);
});
