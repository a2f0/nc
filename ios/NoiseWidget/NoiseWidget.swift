import AppIntents
import SwiftUI
import WidgetKit

struct NoiseEntry: TimelineEntry {
    let date: Date
    let nowPlaying: NoiseType?
}

struct NoiseTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> NoiseEntry {
        NoiseEntry(date: .now, nowPlaying: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (NoiseEntry) -> Void) {
        completion(NoiseEntry(date: .now, nowPlaying: PlaybackStatus.nowPlaying))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NoiseEntry>) -> Void) {
        // The app reloads timelines whenever playback starts or stops.
        let entry = NoiseEntry(date: .now, nowPlaying: PlaybackStatus.nowPlaying)
        completion(Timeline(entries: [entry], policy: .never))
    }
}

/// Home screen widget with a start/stop button for each noise.
struct NoiseWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NoiseWidget", provider: NoiseTimelineProvider()) { entry in
            NoiseWidgetView(entry: entry)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("Noise Connoisseur")
        .description("Start and stop white or pink noise.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct NoiseWidgetView: View {
    let entry: NoiseEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let layout = family == .systemMedium
            ? AnyLayout(HStackLayout(spacing: 8))
            : AnyLayout(VStackLayout(spacing: 8))

        VStack(alignment: .leading, spacing: 8) {
            Text("Noise Connoisseur")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Gray.secondaryLabel)
                .lineLimit(1)
            layout {
                ForEach(NoiseType.allCases) { type in
                    NoiseToggleButton(type: type, isPlaying: entry.nowPlaying == type)
                }
            }
        }
    }
}

private struct NoiseToggleButton: View {
    let type: NoiseType
    let isPlaying: Bool

    var body: some View {
        Group {
            if isPlaying {
                Button(intent: StopNoiseIntent()) { label }
            } else {
                Button(intent: PlayNoiseIntent(noise: type)) { label }
            }
        }
        .buttonStyle(.plain)
    }

    private var label: some View {
        HStack(spacing: 6) {
            Image(systemName: isPlaying ? "stop.fill" : "play.fill")
            Text(type.shortTitle)
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(isPlaying ? Color(.systemBackground) : .primary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(isPlaying ? Color.primary : Gray.secondaryFill, in: .rect(cornerRadius: 12))
    }
}

#Preview(as: .systemSmall) {
    NoiseWidget()
} timeline: {
    NoiseEntry(date: .now, nowPlaying: nil)
    NoiseEntry(date: .now, nowPlaying: .pink)
}
