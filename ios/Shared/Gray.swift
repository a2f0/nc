import SwiftUI
import UIKit

/// Grays with equal red, green, and blue, in place of the system's label, fill, and
/// separator colors, which are tinted slightly blue: nothing in the app has color (see
/// AGENTS.md). Each has the opacities of the system color it replaces.
enum Gray {
    /// Secondary text and symbols, like `secondaryLabel`.
    static let secondaryLabel = Color(light: UIColor(white: 60 / 255, alpha: 0.6), dark: UIColor(white: 235 / 255, alpha: 0.6))
    /// Button backgrounds, like `secondarySystemFill`.
    static let secondaryFill = Color(light: UIColor(white: 120 / 255, alpha: 0.16), dark: UIColor(white: 120 / 255, alpha: 0.32))
    /// The unfilled part of a slider, like `systemFill`.
    static let fill = Color(light: UIColor(white: 120 / 255, alpha: 0.2), dark: UIColor(white: 120 / 255, alpha: 0.36))
    /// Card outlines, like `separator`.
    static let separator = Color(light: UIColor(white: 60 / 255, alpha: 0.29), dark: UIColor(white: 84 / 255, alpha: 0.6))
}

private extension Color {
    init(light: UIColor, dark: UIColor) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
    }
}
