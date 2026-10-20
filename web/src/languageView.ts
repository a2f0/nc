import { LOCALES, languagePreference } from "../../l10n/locales";
import { currentLocale, setPreferredLanguages, t } from "./l10n";
import { LANGUAGE_KEY, readLanguage, saveLanguage } from "./language";

export function setUpLanguage(onChange: () => void): () => void {
  const control = document.getElementById("language");
  if (!(control instanceof HTMLSelectElement)) throw new Error("Missing language picker");
  const select: HTMLSelectElement = control;
  const label = element("language-label");
  const warning = element("language-storage-failed");
  let choice = readLanguage();
  let failed = false;
  select.replaceChildren(...["device", ...LOCALES.map(locale => locale.tag)].map(value => {
    const option = document.createElement("option");
    option.value = value;
    return option;
  }));
  function apply() {
    setPreferredLanguages(choice === "device" ? navigator.languages : [choice]);
    document.documentElement.lang = currentLocale().tag;
    document.documentElement.dir = currentLocale().direction;
  }
  function render() {
    label.textContent = t("language");
    for (const option of select.options) {
      const locale = LOCALES.find(locale => locale.tag === option.value);
      option.textContent = locale?.nativeName ?? t("language_device");
      option.lang = locale?.tag ?? currentLocale().tag;
      option.dir = locale?.direction ?? currentLocale().direction;
    }
    select.value = choice;
    warning.textContent = failed ? t("language_storage_failed") : "";
  }
  select.addEventListener("change", () => {
    choice = languagePreference(select.value);
    failed = !saveLanguage(choice);
    apply();
    onChange();
  });
  window.addEventListener("languagechange", () => {
    if (choice !== "device") return;
    apply();
    onChange();
  });
  window.addEventListener("storage", event => {
    try {
      if (event.storageArea !== localStorage || (event.key !== LANGUAGE_KEY && event.key !== null)) return;
    } catch { return; }
    choice = readLanguage();
    failed = false;
    apply();
    onChange();
  });
  apply();
  return render;
}

function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing #${id}`);
  return result;
}
