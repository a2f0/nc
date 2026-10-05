import SwiftUI

struct ContentView: View {
    private let player = NoisePlayer.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Noise Connoisseur")
                    .font(.largeTitle.bold())
                Text(player.nowPlaying.map { "Playing · \($0.title)" } ?? "Tap a sound to start")
                    .foregroundStyle(.secondary)
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
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: isPlaying ? "stop.fill" : "play.fill")
                    .font(.title3)
                    .foregroundStyle(isPlaying ? Color(.systemBackground) : .primary)
                    .frame(width: 48, height: 48)
                    .background(isPlaying ? Color.primary : Color(.secondarySystemFill), in: .circle)
            }
            .padding(20)
            .background(Color(.systemBackground), in: .rect(cornerRadius: 20))
            .overlay {
                RoundedRectangle(cornerRadius: 20)
                    .strokeBorder(isPlaying ? Color.primary : Color(.separator), lineWidth: isPlaying ? 2 : 1)
            }
            .contentShape(.rect(cornerRadius: 20))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isPlaying ? "Stop \(type.title)" : "Play \(type.title)")
    }
}

#Preview {
    ContentView()
}
