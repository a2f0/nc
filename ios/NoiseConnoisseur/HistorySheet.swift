import SwiftUI

struct HistorySheet: View {
    let history: ListeningHistory
    @State private var offset = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { timeline in
            let end = Calendar.current.date(byAdding: .day, value: offset, to: timeline.date)!
            let days = historyDays(history.snapshot(), ending: end)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        Text(.history).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                        Spacer()
                        Button { dismiss() } label: {
                            Image(systemName: "xmark")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Gray.secondaryLabel)
                                .frame(width: 32, height: 32)
                                .background(Gray.secondaryFill, in: .circle)
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(.rect)
                        }.buttonStyle(.plain).accessibilityLabel(Text(.close))
                    }
                    HStack {
                        Button { offset -= 7 } label: {
                            Image(systemName: "chevron.left").frame(minWidth: 44, minHeight: 44)
                        }.accessibilityLabel(Text(.historyPrevious))
                        Spacer()
                        Button { offset = 0 } label: { Text(.historyToday) }
                        Spacer()
                        Button { offset = min(0, offset + 7) } label: {
                            Image(systemName: "chevron.right").frame(minWidth: 44, minHeight: 44)
                        }.disabled(offset == 0).opacity(offset == 0 ? 0.4 : 1).accessibilityLabel(Text(.historyNext))
                    }
                    Text("\(days[0].start.formatted(date: .abbreviated, time: .omitted)) – \(days[6].start.formatted(date: .abbreviated, time: .omitted))")
                        .font(.subheadline).frame(maxWidth: .infinity)
                    chart(days)
                    if days.allSatisfy({ day in NoiseType.allCases.allSatisfy { (day.minutes[$0.rawValue] ?? 0) == 0 } }) {
                        Text(.historyEmpty).foregroundStyle(Gray.secondaryLabel)
                    }
                    ForEach(Array(NoiseType.allCases.enumerated()), id: \.element) { index, type in
                        HStack {
                            Rectangle().fill(Gray.historyShades[index]).frame(width: 12, height: 12)
                                .overlay(Rectangle().stroke(Gray.secondaryLabel, lineWidth: 0.5)).accessibilityHidden(true)
                            Text(.historyValue(String(localized: type.title), formatted(days.reduce(0) { $0 + ($1.minutes[type.rawValue] ?? 0) })))
                                .font(.subheadline)
                        }
                    }
                    Text(.historyLocal).font(.footnote).foregroundStyle(Gray.secondaryLabel)
                    if history.storageFailed {
                        Text(.historyStorageFailed).font(.footnote).foregroundStyle(Gray.secondaryLabel)
                    }
                }
                .padding(24)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
            }
        }
        .foregroundStyle(Color(uiColor: UIColor.label.grayscale))
        .tint(Color(uiColor: UIColor.label.grayscale))
        .presentationDetents([.large])
        .presentationBackground(Gray.background)
    }

    private func chart(_ days: [HistoryDay]) -> some View {
        let maximum = max(1, ceil(days.map { day in NoiseType.allCases.reduce(0) { $0 + (day.minutes[$1.rawValue] ?? 0) } }.max() ?? 0))
        return VStack(alignment: .leading, spacing: 8) {
            Text(.historyMinutes).font(.caption)
            HStack(alignment: .top, spacing: 6) {
                VStack(alignment: .trailing, spacing: 0) {
                    ForEach((0...4).reversed(), id: \.self) { tick in
                        Text(formatted(maximum * Double(tick) / 4)).font(.caption2)
                        if tick > 0 { Spacer(minLength: 0) }
                    }
                }.frame(height: 190).accessibilityHidden(true)
                VStack(spacing: 8) {
                    HStack(alignment: .bottom, spacing: 10) {
                        ForEach(days) { day in
                            GeometryReader { geometry in
                                VStack(spacing: 0) {
                                    Spacer(minLength: 0)
                                    ForEach(Array(NoiseType.allCases.enumerated().reversed()), id: \.element) { index, type in
                                        let minutes = day.minutes[type.rawValue] ?? 0
                                        if minutes > 0 {
                                            Rectangle().fill(Gray.historyShades[index])
                                                .frame(height: geometry.size.height * minutes / maximum)
                                                .overlay(Rectangle().stroke(Gray.secondaryLabel, lineWidth: 0.5))
                                        }
                                    }
                                }
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(day.start.formatted(date: .complete, time: .omitted))
                            .accessibilityValue(dayDescription(day))
                        }
                    }
                    .frame(height: 180)
                    .background {
                        VStack {
                            ForEach(0...4, id: \.self) { tick in
                                Gray.separator.frame(height: 0.5)
                                if tick < 4 { Spacer() }
                            }
                        }
                    }
                    HStack(spacing: 0) {
                        ForEach(days) { day in
                            Text(day.start, format: .dateTime.month(.twoDigits).day(.twoDigits))
                                .font(.system(size: 10)).lineLimit(1).minimumScaleFactor(0.6)
                                .frame(maxWidth: .infinity).accessibilityHidden(true)
                        }
                    }
                    Text(.historyDate).font(.caption)
                }
            }
        }
    }

    private func formatted(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0...1))) }

    private func dayDescription(_ day: HistoryDay) -> String {
        NoiseType.allCases.map { type in
            String(localized: .historyValue(String(localized: type.title), formatted(day.minutes[type.rawValue] ?? 0)))
        }.joined(separator: "; ")
    }
}
