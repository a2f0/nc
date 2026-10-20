import { LOCALES, languagePreference } from "../../l10n/locales";
import { currentLocale, setPreferredLanguages, t } from "./l10n";
import { LANGUAGE_KEY, readLanguage, saveLanguage } from "./language";

export function setUpLanguage(onChange: () => void): () => void {
  const control = element("language");
  const label = element("language-label");
  const warning = element("language-storage-failed");
  let choice = readLanguage();
  let failed = false;
  const options = ["device", ...LOCALES.map(locale => locale.tag)].map(value => {
    const row = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "language";
    input.value = value;
    const text = document.createElement("span");
    row.append(input, text);
    control.append(row);
    input.addEventListener("change", () => {
      if (!input.checked) return;
      choice = languagePreference(input.value);
      failed = !saveLanguage(choice);
      apply();
      onChange();
    });
    return { input, text };
  });
  function apply() {
    setPreferredLanguages(choice === "device" ? navigator.languages : [choice]);
    document.documentElement.lang = currentLocale().tag;
    document.documentElement.dir = currentLocale().direction;
  }
  function render() {
    label.textContent = t("language");
    for (const { input, text } of options) {
      const locale = LOCALES.find(locale => locale.tag === input.value);
      text.textContent = locale?.nativeName ?? t("language_device");
      text.lang = locale?.tag ?? currentLocale().tag;
      text.dir = locale?.direction ?? currentLocale().direction;
      input.checked = input.value === choice;
    }
    warning.textContent = failed ? t("language_storage_failed") : "";
  }
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
