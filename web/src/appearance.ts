export const APPEARANCES = ["system", "light", "dark"] as const;
export type Appearance = typeof APPEARANCES[number];
export const APPEARANCE_KEY = "appearance";
type StorageAccess = () => Pick<Storage, "getItem" | "setItem">;

export function parseAppearance(value: unknown): Appearance {
  return APPEARANCES.find((option) => option === value) ?? "system";
}

export function readAppearance(storage: StorageAccess = () => localStorage): Appearance {
  try { return parseAppearance(storage().getItem(APPEARANCE_KEY)); }
  catch { return "system"; }
}

export function saveAppearance(value: Appearance, storage: StorageAccess = () => localStorage): boolean {
  try { storage().setItem(APPEARANCE_KEY, value); return true; }
  catch { return false; }
}

// The theme-color tags web/build.ts adds tint the browser's window to the page background,
// one per color scheme; a chosen appearance uses its own scheme's color in either.
export function applyAppearance(value: Appearance): void {
  document.documentElement.dataset.appearance = value;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][data-scheme]')) {
    const scheme = meta.dataset.scheme;
    meta.setAttribute("media", value === "system" ? `(prefers-color-scheme: ${scheme})` : value === scheme ? "all" : "not all");
  }
}

export function isAppearanceStorageEvent(event: StorageEvent): boolean {
  try {
    return event.storageArea === localStorage && (event.key === APPEARANCE_KEY || event.key === null);
  } catch { return false; }
}
