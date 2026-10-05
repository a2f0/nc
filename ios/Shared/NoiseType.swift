import AppIntents

enum NoiseType: String, CaseIterable, Codable, Identifiable, Sendable {
    case white
    case pink

    var id: Self { self }

    var title: String {
        switch self {
        case .white: "White Noise"
        case .pink: "Pink Noise"
        }
    }

    var shortTitle: String {
        switch self {
        case .white: "White"
        case .pink: "Pink"
        }
    }

    var blurb: String {
        switch self {
        case .white: "Equal energy at every frequency. Bright and crisp."
        case .pink: "Softer highs, deeper lows. Like steady rain."
        }
    }
}

extension NoiseType: AppEnum {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Noise"
    static let caseDisplayRepresentations: [NoiseType: DisplayRepresentation] = [
        .white: "White Noise",
        .pink: "Pink Noise",
    ]
}
