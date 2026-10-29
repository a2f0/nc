// The TypeScript module graph: no module imports itself around a chain of others, type-only
// imports included, and each layer imports only its own modules and those below it, as
// docs/development.md#module-layers describes. A cycle tangles two modules into one unit, and a
// value cycle can run a module before the one it needs has initialized; shared types and
// constants belong in a lower module both sides import, as l10n/catalog.ts does for the
// localization build.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const scanned = ["fastlane", "l10n", "scripts", "web"];
const ignored = new Set(["dist", "metadata", "node_modules"]);

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = join(directory, name);
    if (statSync(file).isDirectory()) return ignored.has(name) ? [] : sources(file);
    return /\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [file] : [];
  });
}

// The file a relative specifier names: written as is, without an extension, or as a directory.
function resolveSpecifier(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier.replace(/\.js$/, ".ts"));
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]
    .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

// A module's static relative imports and re-exports, `import type` included. Comments go first,
// so prose naming a module is no edge; a dynamic `import()` loads lazily and is none either.
// (TypeScript 7 has no compiler API, and Bun's import scanner drops type-only imports.)
// A declaration starts a line or follows another's semicolon.
function relativeSpecifiers(source: string): string[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [
    ...text.matchAll(/(?:^|;)\s*(?:import|export)\b[^;]*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']/gm),
    ...text.matchAll(/(?:^|;)\s*import\s*["'](\.{1,2}\/[^"']+)["']/gm),
  ].map((match) => match[1]!);
}

function importsOf(file: string): string[] {
  const specifiers = relativeSpecifiers(readFileSync(file, "utf8"));
  return [...new Set(specifiers.flatMap((specifier) => resolveSpecifier(file, specifier) ?? []))];
}

// Every cycle's modules, by depth-first search, each reported once from where it was entered.
function cyclesOf(files: readonly string[], edges: (file: string) => readonly string[]): string[][] {
  const state = new Map<string, "open" | "done">(), stack: string[] = [], cycles: string[][] = [];
  const visit = (file: string) => {
    state.set(file, "open");
    stack.push(file);
    for (const next of edges(file)) {
      if (state.get(next) === "open") cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(file, "done");
  };
  for (const file of files) if (!state.has(file)) visit(file);
  return cycles;
}

// The layer a repository path is in, lowest first; tests and tools may import any layer.
type Layer = "l10n" | "web-app" | "web-tooling" | "tooling";
function layerOf(path: string): Layer {
  if (/(^|\/)test\//.test(path) || path.endsWith(".test.ts")) return "tooling";
  if (path.startsWith("l10n/")) return "l10n";
  if (path.startsWith("web/src/")) return "web-app";
  if (/^web\/[^/]+\.ts$/.test(path)) return "web-tooling";
  return "tooling";
}
const allowed: Record<Layer, readonly Layer[]> = {
  l10n: ["l10n"],
  "web-app": ["web-app", "l10n"],
  "web-tooling": ["web-tooling", "web-app", "l10n"],
  tooling: ["tooling", "web-tooling", "web-app", "l10n"],
};

const files = scanned.flatMap((directory) => sources(join(root, directory)));
const graph = new Map(files.map((file) => [file, importsOf(file)]));
const named = (file: string) => relative(root, file);

test("no TypeScript module imports itself around a cycle", () => {
  expect(graph.size).toBeGreaterThan(50);
  // Scanning really finds imports, type-only ones included.
  expect(graph.get(join(root, "l10n/languages.ts"))).toContain(join(root, "l10n/catalog.ts"));
  expect(graph.get(join(root, "web/src/main.ts"))?.length).toBeGreaterThan(3);
  const cycles = cyclesOf(files, (file) => graph.get(file) ?? []).map((cycle) => cycle.map(named).join(" -> "));
  expect(cycles).toEqual([]);
});

test("modules import only from their own layer or below", () => {
  const violations = files.flatMap((file) => {
    const from = layerOf(named(file));
    return (graph.get(file) ?? [])
      .filter((target) => !allowed[from].includes(layerOf(named(target))))
      .map((target) => `${named(file)} -> ${named(target)}`);
  });
  expect(violations).toEqual([]);
});

test("cycle detection finds direct, indirect, and self cycles", () => {
  const edges: Record<string, string[]> = { a: ["b"], b: ["c"], c: ["a"], d: ["d"], e: ["a"] };
  expect(cyclesOf(Object.keys(edges), (file) => edges[file] ?? [])).toEqual([["a", "b", "c", "a"], ["d", "d"]]);
});

test("layers rank localization, then the web app, then its tooling, then tests and tools", () => {
  expect(["l10n/build.ts", "web/src/main.ts", "web/build.ts", "web/test/l10n.test.ts", "l10n/test/types.ts", "fastlane/test/lanes.test.ts"].map(layerOf))
    .toEqual(["l10n", "web-app", "web-tooling", "tooling", "tooling", "tooling"]);
});

test("import scanning finds every declaration form and skips comments and dynamic imports", () => {
  const source = [
    'import "./a"; import "./b";',
    'import type { C } from "./c"; export { d } from "./d";',
    "import {",
    "  e,",
    '} from "../e";',
    '// import "./comment";',
    '/* import "./block"; */',
    'const lazy = import("./lazy");',
    'import { f } from "node:fs";',
  ].join("\n");
  expect(relativeSpecifiers(source)).toEqual(["./c", "./d", "../e", "./a", "./b"]);
});
