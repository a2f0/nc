import SwiftUI
import WidgetKit

@main
struct NoiseConnoisseurApp: App {
    @AppStorage("appearance") private var appearance = Appearance.system.rawValue
    @AppStorage(LanguageSettings.key, store: LanguageSettings.defaults) private var language = AppLanguage.device.rawValue
    init() {
        // SwiftUI's Slider has no setting for its unfilled track, which is otherwise
        // the system's slightly blue fill.
        UISlider.appearance().maximumTrackTintColor = UIColor.systemFill.grayscale
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .id(language)
                .environment(\.locale, LanguageSettings.locale)
                .environment(\.layoutDirection, LanguageSettings.layoutDirection)
                .preferredColorScheme((Appearance(rawValue: appearance) ?? .system).colorScheme)
                .onChange(of: language) {
                    NoisePlayer.shared.refreshLanguage()
                    WidgetCenter.shared.reloadAllTimelines()
                }
        }
    }
}
