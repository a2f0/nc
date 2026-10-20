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

export function applyAppearance(value: Appearance): void {
  document.documentElement.dataset.appearance = value;
}

export function isAppearanceStorageEvent(event: StorageEvent): boolean {
  try {
    return event.storageArea === localStorage && (event.key === APPEARANCE_KEY || event.key === null);
  } catch { return false; }
}
