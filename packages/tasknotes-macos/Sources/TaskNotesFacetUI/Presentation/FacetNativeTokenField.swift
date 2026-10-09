import SwiftUI

internal struct FacetNativeTokenField: View {
    let label: String
    let values: [String]
    let vocabulary: [String]
    let changed: ([String]) async -> Bool
    @State private var input = ""
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            if !values.isEmpty {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 100), alignment: .leading)],
                    alignment: .leading, spacing: 6
                ) {
                    ForEach(values, id: \.self) { value in
                        HStack(spacing: 4) {
                            Text(value).lineLimit(1)
                            Button {
                                submit(values.filter { $0 != value })
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                            }
                            .buttonStyle(.plain).foregroundStyle(.secondary).accessibilityLabel(
                                "Remove \(value)")
                        }.font(.caption).padding(.horizontal, 8).padding(.vertical, 4)
                            .background(.quaternary, in: Capsule())
                    }
                }
            }
            HStack {
                TextField("Add \(label.lowercased())…", text: $input).textFieldStyle(.plain)
                    .onSubmit { add(input) }
                if !vocabulary.filter({ !values.contains($0) }).isEmpty {
                    Menu {
                        ForEach(vocabulary.filter { !values.contains($0) }, id: \.self) { value in
                            Button(value) { add(value) }
                        }
                    } label: {
                        Image(systemName: "chevron.down")
                    }
                }
            }
        }.disabled(busy)
    }
    private func add(_ value: String) {
        let token = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty, !values.contains(token) else { return }
        submit(values + [token])
    }
    private func submit(_ updated: [String]) {
        guard !busy else { return }
        busy = true
        _Concurrency.Task {
            if await changed(updated) { input = "" }
            busy = false
        }
    }
}
