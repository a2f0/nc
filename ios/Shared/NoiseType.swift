import AppIntents

enum NoiseType: String, CaseIterable, Codable, Identifiable, Sendable {
    case white
    case pink
    case brown
    case waves
    case fan

    var id: Self { self }

    var title: LocalizedStringResource {
        switch self {
        case .white: .noiseWhiteTitle
        case .pink: .noisePinkTitle
        case .brown: .noiseBrownTitle
        case .waves: .noiseWavesTitle
        case .fan: .noiseFanTitle
        }
    }

    var shortTitle: LocalizedStringResource {
        switch self {
        case .white: .noiseWhiteShort
        case .pink: .noisePinkShort
        case .brown: .noiseBrownShort
        case .waves: .noiseWavesShort
        case .fan: .noiseFanShort
        }
    }

    var blurb: LocalizedStringResource {
        switch self {
        case .white: .noiseWhiteBlurb
        case .pink: .noisePinkBlurb
        case .brown: .noiseBrownBlurb
        case .waves: .noiseWavesBlurb
        case .fan: .noiseFanBlurb
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
        .brown: DisplayRepresentation(title: LocalizedStringResource("noise_brown_title")),
        .waves: DisplayRepresentation(title: LocalizedStringResource("noise_waves_title")),
        .fan: DisplayRepresentation(title: LocalizedStringResource("noise_fan_title")),
    ]
}
