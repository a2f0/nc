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
        .configurationDisplayName(Text(.appName))
        .description(Text(.widgetDescription))
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct NoiseWidgetView: View {
    let entry: NoiseEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        // Rows of buttons: two across on the small widget, three on the medium one. The
        // last row's buttons widen to fill it.
        let columns = family == .systemMedium ? 3 : 2
        let types = NoiseType.allCases
        let rows = stride(from: 0, to: types.count, by: columns).map { Array(types[$0..<min($0 + columns, types.count)]) }

        VStack(alignment: .leading, spacing: 8) {
            Text(.appName)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Gray.secondaryLabel)
                .lineLimit(1)
            VStack(spacing: 6) {
                ForEach(rows, id: \.self) { row in
                    HStack(spacing: 6) {
                        ForEach(row) { type in
                            NoiseToggleButton(type: type, isPlaying: entry.nowPlaying == type)
                        }
                    }
                }
            }
        }
    }
}

private struct NoiseToggleButton: View {
    let type: NoiseType
    let isPlaying: Bool
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.widgetFamily) private var family

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
        HStack(spacing: 4) {
            Image(systemName: isPlaying ? "stop.fill" : "play.fill")
                .imageScale(.small)
            Text(type.shortTitle)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        // The small widget's buttons are half its width.
        .font((family == .systemMedium ? Font.subheadline : .footnote).weight(.semibold))
        .foregroundStyle(isPlaying && isFullColor ? Color(.systemBackground) : .primary)
        .padding(.horizontal, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(background, in: .rect(cornerRadius: 10))
    }

    /// Tinted and clear home screens draw everything in one color, keeping only opacity,
    /// so there a playing button is a stronger fill rather than an inverted one, which
    /// would hide its label.
    private var isFullColor: Bool { renderingMode == .fullColor }

    private var background: Color {
        switch (isPlaying, isFullColor) {
        case (true, true): .primary
        case (true, false): .primary.opacity(0.35)
        case (false, _): Gray.secondaryFill
        }
    }
}

#Preview(as: .systemSmall) {
    NoiseWidget()
} timeline: {
    NoiseEntry(date: .now, nowPlaying: nil)
    NoiseEntry(date: .now, nowPlaying: .pink)
}

#Preview(as: .systemMedium) {
    NoiseWidget()
} timeline: {
    NoiseEntry(date: .now, nowPlaying: nil)
    NoiseEntry(date: .now, nowPlaying: .waves)
}
