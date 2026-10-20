import SwiftUI

struct HistorySheet: View {
    let history: ListeningHistory
    @State private var offset = 0
    @State private var allTime = false

    private struct Bar: Identifiable {
        let id: String
        let label: String
        let accessibilityLabel: String
        let description: String
        let minutes: [String: Double]
    }
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { timeline in
            let end = Calendar.current.date(byAdding: .day, value: offset, to: timeline.date)!
            let sessions = history.snapshot()
            let days = historyDays(sessions, ending: end)
            let totals = allTime ? historyTotals(sessions) : Dictionary(uniqueKeysWithValues: NoiseType.allCases.map { type in
                (type.rawValue, days.reduce(0) { $0 + ($1.minutes[type.rawValue] ?? 0) })
            })
            let bars = allTime ? NoiseType.allCases.map { type in
                Bar(id: type.rawValue, label: String(localized: type.shortTitle),
                    accessibilityLabel: String(localized: .historyValue(String(localized: type.title), formatted(totals[type.rawValue] ?? 0))),
                    description: "",
                    minutes: [type.rawValue: totals[type.rawValue] ?? 0])
            } : days.map { day in
                Bar(id: String(day.start.timeIntervalSince1970),
                    label: day.start.formatted(.dateTime.month(.twoDigits).day(.twoDigits)),
                    accessibilityLabel: day.start.formatted(date: .complete, time: .omitted),
                    description: dayDescription(day),
                    minutes: day.minutes)
            }
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
                    HStack(spacing: 8) {
                        viewButton(.historyAllTime, selected: allTime) { allTime = true }
                        viewButton(.historyCalendar, selected: !allTime) { allTime = false }
                    }
                    if !allTime {
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
                    }
                    chart(bars)
                    if NoiseType.allCases.allSatisfy({ (totals[$0.rawValue] ?? 0) == 0 }) {
                        Text(allTime ? .historyAllTimeEmpty : .historyEmpty).foregroundStyle(Gray.secondaryLabel)
                    }
                    ForEach(Array(NoiseType.allCases.enumerated()), id: \.element) { index, type in
                        HStack {
                            Rectangle().fill(Gray.historyShades[index]).frame(width: 12, height: 12)
                                .overlay(Rectangle().stroke(Gray.secondaryLabel, lineWidth: 0.5)).accessibilityHidden(true)
                            Text(.historyValue(String(localized: type.title), formatted(totals[type.rawValue] ?? 0)))
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
        .foregroundStyle(Gray.label)
        .tint(Gray.label)
        .presentationDetents([.large])
        .presentationBackground(Gray.background)
    }

    private func viewButton(_ title: LocalizedStringResource, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
                .foregroundStyle(selected ? Gray.background : Gray.label)
                .background(selected ? Gray.label : Gray.secondaryFill, in: .rect(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func chart(_ bars: [Bar]) -> some View {
        let maximum = max(1, ceil(bars.map { bar in NoiseType.allCases.reduce(0) { $0 + (bar.minutes[$1.rawValue] ?? 0) } }.max() ?? 0))
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
                        ForEach(bars) { bar in
                            GeometryReader { geometry in
                                VStack(spacing: 0) {
                                    Spacer(minLength: 0)
                                    ForEach(Array(NoiseType.allCases.enumerated().reversed()), id: \.element) { index, type in
                                        let minutes = bar.minutes[type.rawValue] ?? 0
                                        if minutes > 0 {
                                            Rectangle().fill(Gray.historyShades[index])
                                                .frame(height: geometry.size.height * minutes / maximum)
                                                .overlay(Rectangle().stroke(Gray.secondaryLabel, lineWidth: 0.5))
                                        }
                                    }
                                }
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(bar.accessibilityLabel)
                            .accessibilityValue(bar.description)
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
                    HStack(spacing: 10) {
                        ForEach(bars) { bar in
                            Text(bar.label)
                                .font(.system(size: 10)).lineLimit(1).minimumScaleFactor(0.6)
                                .frame(maxWidth: .infinity).accessibilityHidden(true)
                        }
                    }
                    Text(allTime ? .historySound : .historyDate).font(.caption)
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
