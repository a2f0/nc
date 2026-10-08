import SwiftUI

struct ContentView: View {
    private let player = NoisePlayer.shared
    // Scales with the title, for Dynamic Type.
    @ScaledMetric(relativeTo: .largeTitle) private var logoSize = 40

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
