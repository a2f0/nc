import SwiftUI

struct ContentView: View {
    private let player = NoisePlayer.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(.appName)
                    .font(.largeTitle.bold())
                Text(player.nowPlaying.map { .statusPlaying(String(localized: $0.title)) } ?? .statusTapToStart)
                    .foregroundStyle(Gray.secondaryLabel)
                    .padding(.bottom, 8)
                ForEach(NoiseType.allCases) { type in
                    NoiseCard(type: type, isPlaying: player.nowPlaying == type) {
                        player.toggle(type)
                    }
                }
                VolumeSlider(volume: Binding(get: { player.volume }, set: { player.setVolume($0) }))
                    .padding(.top, 8)
            }
            .padding(24)
            .frame(maxWidth: 600, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }
}

private struct NoiseCard: View {
    let type: NoiseType
    let isPlaying: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(type.title)
                        .font(.title3.weight(.semibold))
                    Text(type.blurb)
                        .font(.subheadline)
                        .foregroundStyle(Gray.secondaryLabel)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: isPlaying ? "stop.fill" : "play.fill")
                    .font(.title3)
                    .foregroundStyle(isPlaying ? Color(.systemBackground) : .primary)
                    .frame(width: 48, height: 48)
                    .background(isPlaying ? Color.primary : Gray.secondaryFill, in: .circle)
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
        .accessibilityLabel(Text(isPlaying ? .stopNoise(String(localized: type.title)) : .playNoise(String(localized: type.title))))
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
