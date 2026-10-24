import SwiftUI

enum LanguageSettings {
    static let key = "language"
    static var defaults: UserDefaults {
        let group = Bundle.main.object(forInfoDictionaryKey: "NCAppGroupID") as? String
        return group.flatMap(UserDefaults.init(suiteName:)) ?? .standard
    }

    static var selected: AppLanguage {
        AppLanguage(rawValue: defaults.string(forKey: key) ?? "") ?? .device
    }

    static var locale: Locale {
        selected == .device ? .current : Locale(identifier: selected.rawValue)
    }

    static var layoutDirection: LayoutDirection {
        let deviceLanguage = Locale.Language(identifier: Bundle.main.preferredLocalizations.first ?? "en")
        let rtl = selected == .device ? deviceLanguage.characterDirection == .rightToLeft : selected.isRTL
        return rtl ? .rightToLeft : .leftToRight
    }

    static func resource(_ value: LocalizedStringResource) -> LocalizedStringResource {
        var result = value
        result.locale = locale
        return result
    }

    static func string(_ value: LocalizedStringResource) -> String {
        String(localized: resource(value))
    }
}

/// Preserve Xcode's typed catalog symbols, including interpolation, with the saved locale.
func localizedText(_ value: LocalizedStringResource) -> Text {
    Text(LanguageSettings.resource(value))
}
