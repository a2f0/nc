import SwiftUI

/// A sheet with a title and a close button, as tall as its contents.
struct SheetContent<Content: View>: View {
    let title: LocalizedStringResource
    @ViewBuilder let content: Content
    @State private var height: CGFloat = 0
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    localizedText(title)
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
                    .accessibilityLabel(localizedText(.close))
                }
                content
            }
            .padding(.horizontal, 24)
            .padding(.top, 16)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .presentationDetents(height > 0 ? [.height(height)] : [.medium])
        .presentationBackground(Gray.background)
    }
}
