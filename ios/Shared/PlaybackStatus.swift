import Foundation

/// What's playing, persisted in the App Group so the widget can render it.
enum PlaybackStatus {
    private static let key = "nowPlaying"

    private static var defaults: UserDefaults {
        let groupID = Bundle.main.object(forInfoDictionaryKey: "NCAppGroupID") as? String
        return groupID.flatMap(UserDefaults.init(suiteName:)) ?? .standard
    }

    static var nowPlaying: NoiseType? {
        get { defaults.string(forKey: key).flatMap(NoiseType.init(rawValue:)) }
        set { defaults.set(newValue?.rawValue, forKey: key) }
    }
}
