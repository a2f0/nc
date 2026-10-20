import { applyAppearance, isAppearanceStorageEvent, readAppearance } from "./appearance";

// A small blocking script in <head>: resolve the saved theme before the first paint.
applyAppearance(readAppearance());
window.addEventListener("storage", (event) => {
  if (isAppearanceStorageEvent(event)) applyAppearance(readAppearance());
});
