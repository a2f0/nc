import SwiftUI

struct ContentView: View {
    private let player = NoisePlayer.shared
    // Scales with the title, for Dynamic Type.
    @ScaledMetric(relativeTo: .largeTitle) private var logoSize = 40
    @State private var sheet: Sheet?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // The logo's bottom edge is its baseline, so it sits on the title's.
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    // The app icon's corners: 224 of its 1024 points.
                    Image(.logo)
                        .resizable()
                        .frame(width: logoSize, height: logoSize)
                        .clipShape(.rect(cornerRadius: logoSize * 224 / 1024, style: .continuous))
                        .accessibilityHidden(true)
                    // One line, shrinking to fit narrow screens and large text sizes.
                    Text(.appName)
                        .font(.largeTitle.bold())
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .accessibilityAddTraits(.isHeader)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    MoreMenu(sheet: $sheet)
                }
                .padding(.bottom, 8)
                ForEach(NoiseType.allCases) { type in
                    NoiseCard(type: type, isPlaying: player.nowPlaying == type) {
                        player.toggle(type)
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 600, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        // Stays at the bottom of the screen while the sounds scroll under it.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            PlayerBar(player: player)
        }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .settings: SettingsSheet(player: player)
            case .about: AboutSheet()
            }
        }
    }
}

/// The sheets the menu opens.
private enum Sheet: Identifiable {
    case settings
    case about

    var id: Self { self }
}

/// The three-dot menu at the end of the title: Settings, Rate App, and About.
private struct MoreMenu: View {
    @Binding var sheet: Sheet?
    @Environment(\.openURL) private var openURL

    /// The App Store's page for writing a review. 6819365110 is the app's Apple ID in App
    /// Store Connect.
    private static let reviewURL = URL(string: "https://apps.apple.com/app/id6819365110?action=write-review")!

    var body: some View {
        Menu {
            Button { sheet = .settings } label: {
                Label { Text(.settings) } icon: { Image(systemName: "gearshape") }
            }
            Button { openURL(Self.reviewURL) } label: {
                Label { Text(.rateApp) } icon: { Image(systemName: "star") }
            }
            Button { sheet = .about } label: {
                Label { Text(.about) } icon: { Image(systemName: "info.circle") }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.title2)
                .foregroundStyle(.primary)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(.rect)
        }
        // The symbol lines up with the cards' trailing edge; its tap target reaches past it.
        .padding(.trailing, -9)
        .accessibilityLabel(Text(.more))
    }
}

/// Settings: for now, the volume.
private struct SettingsSheet: View {
    let player: NoisePlayer

    var body: some View {
        SheetContent(title: .settings) {
            VStack(alignment: .leading, spacing: 8) {
                // The slider reads its own label.
                Text(.volume)
                    .font(.headline)
                    .accessibilityHidden(true)
                VolumeSlider(volume: Binding(get: { player.volume }, set: { player.setVolume($0) }))
                    // For the Maestro flows (maestro/screenshots/).
                    .accessibilityIdentifier("settings-volume")
            }
        }
    }
}

/// The app's name, version, and build, with links to the Android app and the website.
private struct AboutSheet: View {
    @ScaledMetric(relativeTo: .title3) private var logoSize = 64

    private static let info = Bundle.main.infoDictionary ?? [:]
    private static let version = info["CFBundleShortVersionString"] as? String ?? ""
    private static let build = info["CFBundleVersion"] as? String ?? ""

    private static let playURL = URL(string: "https://play.google.com/store/apps/details?id=net.a2f0.nc")!
    private static let webURL = URL(string: "https://nc.a2f0.net")!

    var body: some View {
        SheetContent(title: .about) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 16) {
                    Image(.logo)
                        .resizable()
                        .frame(width: logoSize, height: logoSize)
                        .clipShape(.rect(cornerRadius: logoSize * 224 / 1024, style: .continuous))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(.appName)
                            .font(.title3.weight(.semibold))
                        Text(.aboutVersion(Self.version, Self.build))
                            .font(.subheadline)
                            .foregroundStyle(Gray.secondaryLabel)
                    }
                }
                Text(Self.alsoOn)
                    .font(.subheadline)
                    .foregroundStyle(Gray.secondaryLabel)
                    // Links take the tint, which would otherwise be the blue accent color.
                    .tint(Gray.secondaryLabel)
            }
        }
    }

    /// "Also available on Android and the web.", with each of those linked.
    private static var alsoOn: AttributedString {
        let android = String(localized: .platformAndroid)
        let web = String(localized: .platformWeb)
        var text = AttributedString(String(localized: .aboutAlsoAndroidWeb(android, web)))
        for (label, url) in [(android, playURL), (web, webURL)] {
            guard let range = text.range(of: label) else { continue }
            text[range].link = url
            text[range].underlineStyle = Text.LineStyle.single
        }
        return text
    }
}

/// A sheet with a title and a close button, as tall as its contents.
private struct SheetContent<Content: View>: View {
    let title: LocalizedStringResource
    @ViewBuilder let content: Content
    @State private var height: CGFloat = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(title)
                    .font(.title2.bold())
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 16)
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Gray.secondaryLabel)
                        .frame(width: 32, height: 32)
                        .background(Gray.secondaryFill, in: .circle)
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                // Lines up with the contents' trailing edge, as in the title.
                .padding(.trailing, -6)
                .accessibilityLabel(Text(.close))
            }
            content
        }
        .padding(.horizontal, 24)
        .padding(.top, 16)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        .presentationDetents(height > 0 ? [.height(height)] : [.medium])
        .presentationBackground(Gray.background)
    }
}

private struct NoiseCard: View {
    let type: NoiseType
    let isPlaying: Bool
    let action: () -> Void
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        // At accessibility text sizes the button goes under the text, which keeps its width.
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 16))
            : AnyLayout(HStackLayout(spacing: 16))

        Button(action: action) {
            layout {
                VStack(alignment: .leading, spacing: 4) {
                    Text(type.title)
                        .font(.title3.weight(.semibold))
                    Text(type.blurb)
                        .font(.subheadline)
                        .foregroundStyle(Gray.secondaryLabel)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                PlaybackSymbol(isPlaying: isPlaying)
            }
            .padding(20)
            .background(Color(.systemBackground), in: .rect(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20)
                    .strokeBorder(isPlaying ? Color.primary : Gray.separator, lineWidth: isPlaying ? 2 : 1)
            }
            .contentShape(.rect(cornerRadius: 20))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(type.buttonLabel(isPlaying: isPlaying)))
    }
}

/// Pinned to the bottom of the screen: stops the noise, or plays the last one again, and
/// sets the volume.
private struct PlayerBar: View {
    let player: NoisePlayer
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let isPlaying = player.nowPlaying != nil
        HStack(spacing: 16) {
            Button(action: player.togglePlayback) {
                PlaybackSymbol(isPlaying: isPlaying)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text((player.nowPlaying ?? player.lastPlayed).buttonLabel(isPlaying: isPlaying)))
            // For the Maestro flows (maestro/screenshots/).
            .accessibilityIdentifier("playback")
            VolumeSlider(volume: Binding(get: { player.volume }, set: { player.setVolume($0) }))
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .frame(maxWidth: 600)
        .frame(maxWidth: .infinity)
        .background(Color(.systemBackground))
        .overlay(alignment: .top) {
            Gray.separator.frame(height: 1 / displayScale)
        }
    }
}

/// A play or stop symbol in a circle, filled while playing.
private struct PlaybackSymbol: View {
    let isPlaying: Bool
    @ScaledMetric(relativeTo: .title3) private var size = 48

    var body: some View {
        Image(systemName: isPlaying ? "stop.fill" : "play.fill")
            .font(.title3)
            .foregroundStyle(isPlaying ? Color(.systemBackground) : .primary)
            .frame(width: size, height: size)
            .background(isPlaying ? Color.primary : Gray.secondaryFill, in: .circle)
    }
}

private extension NoiseType {
    /// A screen reader label for a button that stops this noise while it plays, or plays it.
    func buttonLabel(isPlaying: Bool) -> LocalizedStringResource {
        let title = String(localized: title)
        return isPlaying ? .stopNoise(title) : .playNoise(title)
    }
}

private struct VolumeSlider: View {
    @Binding var volume: Double

    var body: some View {
        Slider(value: $volume, in: 0...1) {
            Text(.volume)
        } minimumValueLabel: {
            Image(systemName: "speaker.fill")
                .foregroundStyle(Gray.secondaryLabel)
        } maximumValueLabel: {
            Image(systemName: "speaker.wave.3.fill")
                .foregroundStyle(Gray.secondaryLabel)
        }
        .tint(.primary)
        .padding(.horizontal, 4)
    }
}

#Preview {
    ContentView()
}
