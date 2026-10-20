import SwiftUI

struct HistorySheet: View {
    let history: ListeningHistory
    @State private var offset = 0
    @State private var allTime = false
    @State private var selectedSound: NoiseType?
    @State private var detailOffset = 0
    @AccessibilityFocusState private var focusedSound: NoiseType?
    @AccessibilityFocusState private var detailFocused: Bool

    private var showAllTime: Bool { allTime && selectedSound == nil }
    private var activeOffset: Int { selectedSound == nil ? offset : detailOffset }
    private var sounds: [NoiseType] { selectedSound.map { [$0] } ?? NoiseType.allCases }

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
            let end = Calendar.current.date(byAdding: .day, value: activeOffset, to: timeline.date)!
            let sessions = history.snapshot().filter { selectedSound == nil || $0.soundId == selectedSound?.rawValue }
            let days = historyDays(sessions, ending: end)
            let totals = showAllTime ? historyTotals(sessions) : Dictionary(uniqueKeysWithValues: NoiseType.allCases.map { type in
                (type.rawValue, days.reduce(0) { $0 + ($1.minutes[type.rawValue] ?? 0) })
            })
            let bars = showAllTime ? NoiseType.allCases.map { type in
                Bar(id: type.rawValue, label: LanguageSettings.string(type.shortTitle),
                    accessibilityLabel: LanguageSettings.string(.historyValue(LanguageSettings.string(type.title), formatted(totals[type.rawValue] ?? 0))),
                    description: "",
                    minutes: [type.rawValue: totals[type.rawValue] ?? 0])
            } : days.map { day in
                Bar(id: String(day.start.timeIntervalSince1970),
                    label: day.start.formatted(.dateTime.month(.twoDigits).day(.twoDigits).locale(LanguageSettings.locale)),
                    accessibilityLabel: day.start.formatted(Date.FormatStyle(date: .complete, time: .omitted).locale(LanguageSettings.locale)),
                    description: dayDescription(day),
                    minutes: day.minutes)
            }
            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        HStack {
                            localizedText(.history).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                            Spacer()
                            Button { dismiss() } label: {
                                Image(systemName: "xmark")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(Gray.secondaryLabel)
                                    .frame(width: 32, height: 32)
                                    .background(Gray.secondaryFill, in: .circle)
                                    .frame(minWidth: 44, minHeight: 44)
                                    .contentShape(.rect)
                            }.buttonStyle(.plain).accessibilityLabel(localizedText(.close))
                        }.id("history-top")
                        if let selectedSound {
                            Button {
                                let sound = selectedSound
                                self.selectedSound = nil
                                focusedSound = sound
                            } label: {
                                Label { localizedText(.historyBack) } icon: { Image(systemName: "chevron.left") }
                                    .frame(minHeight: 44)
                            }.buttonStyle(.plain)
                            localizedText(.historyDaily(LanguageSettings.string(selectedSound.title)))
                                .font(.headline).accessibilityAddTraits(.isHeader)
                                .accessibilityFocused($detailFocused)
                        } else {
                            HStack(spacing: 8) {
                                viewButton(.historyAllTime, selected: allTime) { allTime = true }
                                viewButton(.historyCalendar, selected: !allTime) { allTime = false }
                            }
                        }
                        if !showAllTime {
                            HStack {
                                Button { move(-7) } label: {
                                    Image(systemName: "chevron.left").frame(minWidth: 44, minHeight: 44)
                                }.accessibilityLabel(localizedText(.historyPrevious))
                                Spacer()
                                Button { move(nil) } label: { localizedText(.historyToday) }
                                Spacer()
                                Button { move(7) } label: {
                                    Image(systemName: "chevron.right").frame(minWidth: 44, minHeight: 44)
                                }.disabled(activeOffset == 0).opacity(activeOffset == 0 ? 0.4 : 1).accessibilityLabel(localizedText(.historyNext))
                            }
                            Text("\(days[0].start.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted).locale(LanguageSettings.locale))) – \(days[6].start.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted).locale(LanguageSettings.locale)))")
                                .font(.subheadline).frame(maxWidth: .infinity)
                        }
                        chart(bars)
                        if NoiseType.allCases.allSatisfy({ (totals[$0.rawValue] ?? 0) == 0 }) {
                            localizedText(showAllTime ? .historyAllTimeEmpty : .historyEmpty).foregroundStyle(Gray.secondaryLabel)
                        }
                        if selectedSound == nil {
                            ForEach(Array(NoiseType.allCases.enumerated()), id: \.element) { index, type in
                                Button {
                                    selectedSound = type
                                    detailOffset = allTime ? 0 : offset
                                    detailFocused = true
                                } label: {
                                    HStack {
                                        Rectangle().fill(Gray.historyShades[index]).frame(width: 12, height: 12)
                                            .overlay(Rectangle().stroke(Gray.secondaryLabel, lineWidth: 0.5)).accessibilityHidden(true)
                                        localizedText(.historyValue(LanguageSettings.string(type.title), formatted(totals[type.rawValue] ?? 0)))
                                            .font(.subheadline)
                                        Spacer()
                                        Image(systemName: "chevron.right").accessibilityHidden(true)
                                    }.frame(minHeight: 44).contentShape(.rect)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("history-sound-\(type.rawValue)")
                                .accessibilityHint(localizedText(.historyDaily(LanguageSettings.string(type.title))))
                                .accessibilityFocused($focusedSound, equals: type)
                            }
                        }
                        localizedText(.historyLocal).font(.footnote).foregroundStyle(Gray.secondaryLabel)
                        if history.storageFailed {
                            localizedText(.historyStorageFailed).font(.footnote).foregroundStyle(Gray.secondaryLabel)
                        }
                    }
                    .padding(24)
                    .frame(maxWidth: 600)
                    .frame(maxWidth: .infinity)
                }
                .onChange(of: selectedSound) { scroll.scrollTo("history-top", anchor: .top) }
            }
        }
        .foregroundStyle(Gray.label)
        .tint(Gray.label)
        .presentationDetents([.large])
        .presentationBackground(Gray.background)
    }

    private func move(_ days: Int?) {
        if selectedSound == nil { offset = days.map { min(0, offset + $0) } ?? 0 }
        else { detailOffset = days.map { min(0, detailOffset + $0) } ?? 0 }
    }

    private func viewButton(_ title: LocalizedStringResource, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            localizedText(title).font(.subheadline.weight(.semibold))
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
            localizedText(.historyMinutes).font(.caption)
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
                    localizedText(showAllTime ? .historySound : .historyDate).font(.caption)
                }
            }
        }
    }

    private func formatted(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0...1)).locale(LanguageSettings.locale)) }

    private func dayDescription(_ day: HistoryDay) -> String {
        sounds.map { type in
            LanguageSettings.string(.historyValue(LanguageSettings.string(type.title), formatted(day.minutes[type.rawValue] ?? 0)))
        }.joined(separator: "; ")
    }
}
