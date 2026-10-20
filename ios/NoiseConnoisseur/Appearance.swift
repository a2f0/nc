import SwiftUI

/// Raw values are permanent preference keys, independent of translated labels.
enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: Self { self }
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
    var title: LocalizedStringResource {
        switch self {
        case .system: .appearanceSystem
        case .light: .appearanceLight
        case .dark: .appearanceDark
        }
    }
}
