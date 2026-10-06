import SwiftUI

@main
struct NoiseConnoisseurApp: App {
    init() {
        // SwiftUI's Slider has no setting for its unfilled track, which is otherwise
        // the system's slightly blue fill.
        UISlider.appearance().maximumTrackTintColor = UIColor.systemFill.grayscale
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
