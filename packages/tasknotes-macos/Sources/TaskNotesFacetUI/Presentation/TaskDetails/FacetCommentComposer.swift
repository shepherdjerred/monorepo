import Foundation
import PhotosUI
import SwiftUI
import TaskNotesKit
import UniformTypeIdentifiers

internal struct FacetCommentFile {
    static let limit = 16 * 1024 * 1024
    let name: String
    let data: Data

    static func safeName(_ name: String) -> String? {
        guard !name.isEmpty, name != ".", name != "..", name.utf8.count <= 255,
            !name.contains("/"), !name.contains("\\"),
            name.rangeOfCharacter(from: .controlCharacters) == nil
        else { return nil }
        return name
    }
}

internal struct FacetCommentComposer: View {
    let task: TaskNotesKit.Task
    let store: FacetStore
    @State private var text = ""
    @State private var file: FacetCommentFile?
    @State private var pickingFile = false
    @State private var photo: PhotosPickerItem?
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if let file {
                HStack {
                    Label(file.name, systemImage: "paperclip").lineLimit(1)
                    Button("Remove", systemImage: "xmark.circle") { self.file = nil }
                        .labelStyle(.iconOnly)
                }.font(.caption)
            }
            HStack {
                Menu {
                    PhotosPicker(selection: $photo, matching: .images) {
                        Label("Photo", systemImage: "photo")
                    }
                    Button("File", systemImage: "doc") { pickingFile = true }
                } label: {
                    Image(systemName: "paperclip")
                }.accessibilityLabel("Attach photo or file")
                TextField("Comment", text: $text, axis: .vertical).lineLimit(1...4)
                Button("Post comment", systemImage: "arrow.up.circle.fill", action: post)
                    .labelStyle(.iconOnly)
                    .disabled(loading || (trimmed.isEmpty && file == nil))
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
        }
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
        .fileImporter(isPresented: $pickingFile, allowedContentTypes: [.item]) { result in
            do {
                let url = try result.get()
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                guard values.isRegularFile == true, let count = values.fileSize,
                    count <= FacetCommentFile.limit,
                    let name = FacetCommentFile.safeName(url.lastPathComponent)
                else {
                    error = "Choose a file up to 16 MB with a valid filename."
                    return
                }
                let data = try Data(contentsOf: url, options: .mappedIfSafe)
                guard data.count <= FacetCommentFile.limit else {
                    error = "Choose a file up to 16 MB."
                    return
                }
                file = FacetCommentFile(name: name, data: data)
                error = nil
            } catch { self.error = error.localizedDescription }
        }
        .task(id: photo) { await loadPhoto() }
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func loadPhoto() async {
        guard let photo else { return }
        loading = true
        defer { loading = false }
        do {
            guard let data = try await photo.loadTransferable(type: Data.self),
                data.count <= FacetCommentFile.limit
            else {
                error = "Choose a photo up to 16 MB."
                return
            }
            try _Concurrency.Task.checkCancellation()
            let ext = photo.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            file = FacetCommentFile(name: "Photo.\(ext)", data: data)
            error = nil
        } catch is CancellationError { return } catch { self.error = error.localizedDescription }
    }

    private func post() {
        guard trimmed.utf16.count <= 32_000 else {
            error = "Use 32,000 characters or fewer."
            return
        }
        let comment = TaskComment(
            id: UUID().uuidString, body: trimmed, created_at: Date.now.ISO8601Format(),
            file_name: file?.name)
        var patch = FacetTaskPatch()
        patch.appendComment = CommentUpload(
            comment: comment, attachment_base64: file?.data.base64EncodedString())
        store.localStore.updateTask(
            id: store.localStore.resolvedID(task.id), patch: patch, recordUndo: false)
        store.scheduleAutoSync()
        text = ""
        file = nil
        photo = nil
        error = nil
    }
}
