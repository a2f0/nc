import AppIntents

enum NoiseType: String, CaseIterable, Codable, Identifiable, Sendable {
    case white
    case pink

    var id: Self { self }

    var title: LocalizedStringResource {
        switch self {
        case .white: .noiseWhiteTitle
        case .pink: .noisePinkTitle
        }
    }

    var shortTitle: LocalizedStringResource {
        switch self {
        case .white: .noiseWhiteShort
        case .pink: .noisePinkShort
        }
    }

    var blurb: LocalizedStringResource {
        switch self {
        case .white: .noiseWhiteBlurb
        case .pink: .noisePinkBlurb
        }
    }
}

// App Intents builds its metadata from literal keys, not the generated symbols; `bun run
// l10n` checks that each is an iOS string in l10n/strings.ts.
extension NoiseType: AppEnum {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: LocalizedStringResource("intent_noise"))
    static let caseDisplayRepresentations: [NoiseType: DisplayRepresentation] = [
        .white: DisplayRepresentation(title: LocalizedStringResource("noise_white_title")),
        .pink: DisplayRepresentation(title: LocalizedStringResource("noise_pink_title")),
    ]
}
