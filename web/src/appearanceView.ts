import { APPEARANCES, applyAppearance, isAppearanceStorageEvent, readAppearance, saveAppearance } from "./appearance";
import { t } from "./l10n";

export function setUpAppearance(): () => void {
  let selected = readAppearance();
  let failed = false;
  const inputs = APPEARANCES.map((option) =>
    document.getElementById(`appearance-${option}`) as HTMLInputElement);
  const failure = document.getElementById("appearance-storage-failed")!;
  function render(): void {
    applyAppearance(selected);
    document.getElementById("appearance-title")!.textContent = t("appearance");
    inputs.forEach((input, index) => {
      const option = APPEARANCES[index]!;
      input.checked = selected === option;
      document.getElementById(`appearance-label-${option}`)!.textContent = t(`appearance_${option}`);
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
