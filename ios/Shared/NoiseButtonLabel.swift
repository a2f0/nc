import Foundation

extension NoiseType {
    /// A screen reader label for a button that stops this noise while it plays, or plays it.
    func buttonLabel(isPlaying: Bool) -> LocalizedStringResource {
        let title = LanguageSettings.string(title)
        return isPlaying ? .stopNoise(title) : .playNoise(title)
    }
}
