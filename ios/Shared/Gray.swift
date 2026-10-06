import SwiftUI
import UIKit

/// Gray versions of the system's label, fill, and separator colors, which are tinted
/// slightly blue: nothing in the app has color (see AGENTS.md).
enum Gray {
    /// Secondary text and symbols.
    static let secondaryLabel = Color(uiColor: UIColor.secondaryLabel.grayscale)
    /// Button backgrounds.
    static let secondaryFill = Color(uiColor: UIColor.secondarySystemFill.grayscale)
    /// Card outlines.
    static let separator = Color(uiColor: UIColor.separator.grayscale)
}

extension UIColor {
    /// This color resolved for the current traits (light or dark, increased contrast)
    /// and turned gray: the same luma (Rec. 709 weights) and opacity, with no hue.
    var grayscale: UIColor {
        UIColor { traits in
            var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
            self.resolvedColor(with: traits).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
            return UIColor(white: 0.2126 * red + 0.7152 * green + 0.0722 * blue, alpha: alpha)
        }
    }
}
