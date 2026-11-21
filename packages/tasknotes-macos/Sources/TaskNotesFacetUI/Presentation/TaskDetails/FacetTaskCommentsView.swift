import Foundation
import QuickLook
import SwiftUI
import TaskNotesKit

internal struct FacetTaskCommentsView: View {
    let task: TaskNotesKit.Task
    let store: FacetStore
    @State private var previewURL: URL?
    @State private var previewDirectory: URL?
    @State private var loading = false
    @State private var expanded = false
    @State private var error: String?

    static func count(for task: TaskNotesKit.Task) -> Int { task.comments?.count ?? 0 }

    var body: some View {
        let notes = task.chronologicalComments
        if !notes.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    expanded.toggle()
                } label: {
                    HStack {
                        Text("Comments \(notes.count)").font(.subheadline.bold())
                        Spacer()
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    }
                }
                .buttonStyle(.plain)
                ForEach(expanded ? notes : Array(notes.suffix(1)), id: \.id) { note in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(
                                FacetCommentDate.parse(note.created_at),
                                format: .dateTime.month().day().hour().minute()
                            )
                            .foregroundStyle(.secondary).font(.caption)
                            Spacer()
                            Menu {
                                if note.file_name != nil {
                                    Button("Remove attachment", role: .destructive) {
                                        var patch = FacetTaskPatch()
                                        patch.removeAttachmentID = note.id
                                        apply(patch)
                                    }
                                }
                                Button("Delete comment", role: .destructive) {
                                    var patch = FacetTaskPatch()
                                    patch.removeCommentID = note.id
                                    apply(patch)
                                }
                            } label: {
                                Image(systemName: "ellipsis")
                            }
                            .accessibilityLabel("Comment actions")
                        }
                        if !note.body.isEmpty { Text(note.body).textSelection(.enabled) }
                        if let fileName = note.file_name {
                            Button {
                                _Concurrency.Task { await open(note, fileName: fileName) }
                            } label: {
                                Label(fileName, systemImage: "paperclip")
                            }.disabled(loading)
                        }
                    }
                }
                if let error { Text(error).foregroundStyle(.red).font(.caption) }
            }
            .quickLookPreview($previewURL)
            .onChange(of: previewURL) { _, newValue in
                if newValue == nil { clearPreview() }
            }
            .onDisappear { clearPreview() }
        }
    }

    private func apply(_ patch: FacetTaskPatch) {
        store.localStore.updateTask(
            id: store.localStore.resolvedID(task.id), patch: patch, recordUndo: false)
        store.scheduleAutoSync()
    }

    private func clearPreview() {
        if let directory = previewDirectory {
            do { try FileManager.default.removeItem(at: directory) } catch {
                self.error = error.localizedDescription
            }
        }
        previewDirectory = nil
    }

    private func open(_ note: TaskComment, fileName: String) async {
        guard let safeName = FacetCommentFile.safeName(fileName) else {
            error = "Invalid attachment name."
            return
        }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let data: Data
            if let pending = store.localStore.outbox.lazy.compactMap({ entry -> String? in
                guard case .taskUpdate(let args) = entry.command,
                    args.append_comment?.comment.id == note.id
                else { return nil }
                return args.append_comment?.attachment_base64
            }).first, let bytes = Data(base64Encoded: pending) {
                data = bytes
            } else if let client = store.makeAPIClient() {
                data = try await client.attachment(
                    taskID: store.localStore.resolvedID(task.id), commentID: note.id)
            } else {
                self.error = "Connect to your Facet server to open this attachment."
                return
            }
            clearPreview()
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent(
                UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(
                at: dir, withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700])
            previewDirectory = dir
            let file = dir.appendingPathComponent(safeName)
            try data.write(to: file, options: [.atomic, .completeFileProtection])
            previewURL = file
        } catch { self.error = error.localizedDescription }
    }
}
