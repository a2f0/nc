import { APPEARANCES, applyAppearance, isAppearanceStorageEvent, readAppearance, saveAppearance } from "./appearance";
import { t } from "./l10n";

export function setUpAppearance(): () => void {
  let selected = readAppearance();
  let failed = false;
  const inputs = APPEARANCES.map((option) => {
    const input = element(`appearance-${option}`);
    if (!(input instanceof HTMLInputElement)) throw new Error(`Expected radio input #appearance-${option}`);
    return input;
  });
  const failure = element("appearance-storage-failed");
  function render(): void {
    applyAppearance(selected);
    element("appearance-title").textContent = t("appearance");
    inputs.forEach((input, index) => {
      const option = APPEARANCES[index]!;
      input.checked = selected === option;
      element(`appearance-label-${option}`).textContent = t(`appearance_${option}`);
    });
    failure.textContent = failed ? t("appearance_storage_failed") : "";
  }
  inputs.forEach((input, index) => input.addEventListener("change", () => {
    if (!input.checked) return;
    selected = APPEARANCES[index]!;
    failed = !saveAppearance(selected);
    render();
  }));
  window.addEventListener("storage", (event) => {
    if (!isAppearanceStorageEvent(event)) return;
    selected = readAppearance();
    failed = false;
    render();
  });
  return render;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing #${id}`);
  return found;
}
