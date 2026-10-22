import SwiftUI

struct PlaybackLogSheet: View {
    let log: PlaybackLog

    private var text: String {
        log.entries.reversed().map { row in
            let sound = row.soundId.flatMap(NoiseType.init(rawValue:)).map { LanguageSettings.string($0.title) } ?? ""
            return "\(row.timestamp.ISO8601Format())  \(sound)\n\(LanguageSettings.string(row.event.title)) [\(row.event.rawValue)]\n\(row.detail)"
        }.joined(separator: "\n\n")
    }

    var body: some View {
        SheetContent(title: .playbackLog) {
            localizedText(.playbackLogLocal).foregroundStyle(Gray.secondaryLabel)
            if log.storageFailed { localizedText(.playbackLogStorageFailed) }
            ShareLink(item: LanguageSettings.string(.playbackLog) + "\n\n" + text) {
                Label { localizedText(.playbackLogShare) } icon: { Image(systemName: "square.and.arrow.up") }
                    .frame(minHeight: 44)
            }
            .tint(Gray.label)
            .disabled(log.entries.isEmpty)
            if log.entries.isEmpty { localizedText(.playbackLogEmpty) }
            else {
                Text(verbatim: text).font(.caption.monospaced()).foregroundStyle(Gray.label)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
