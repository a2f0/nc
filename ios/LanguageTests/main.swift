import Foundation

// Run in a temporary .app with the real compiled catalog, not mocked translations.
let defaults = LanguageSettings.defaults
let previous = defaults.object(forKey: LanguageSettings.key)
defer {
    if let previous {
        defaults.set(previous, forKey: LanguageSettings.key)
    } else {
        defaults.removeObject(forKey: LanguageSettings.key)
    }
}

for (language, expected) in [(AppLanguage.en, "Volume"), (.de, "Lautstärke"), (.es, "Volumen")] {
    defaults.set(language.rawValue, forKey: LanguageSettings.key)
    precondition(LanguageSettings.selected == language)
    precondition(LanguageSettings.string(.volume) == expected, "Catalog lookup failed for \(language)")
}

defaults.set("removed-language", forKey: LanguageSettings.key)
precondition(LanguageSettings.selected == .device)
precondition(LanguageSettings.locale == .current)
defaults.removeObject(forKey: LanguageSettings.key)
precondition(LanguageSettings.selected == .device)
print("Language catalog lookup: English, German, Spanish, and device fallback passed")
