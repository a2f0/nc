import SwiftUI

@main
struct NoiseConnoisseurApp: App {
    @AppStorage("appearance") private var appearance = Appearance.system.rawValue
    init() {
        // SwiftUI's Slider has no setting for its unfilled track, which is otherwise
        // the system's slightly blue fill.
        UISlider.appearance().maximumTrackTintColor = UIColor.systemFill.grayscale
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme((Appearance(rawValue: appearance) ?? .system).colorScheme)
        }
    }
}
