public import Foundation
public import TaskNotesKit

extension FacetStore {
    public func importCopy(_ source: URL) async {
        await runImport { importer in try await importer.begin(source: source) }
    }

    public func retryImport(_ imported: FacetVaultImport) async {
        await runImport { importer in try await importer.retry(id: imported.id) }
    }

    private func runImport(
        _ operation: (FacetVaultImporter) async throws -> FacetVaultImport
    ) async {
        guard let importer, let engine, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let copied = try await operation(importer)
            let target = try await importer.completedDirectory(id: copied.id)
            let profile = try await engine.registerImported(
                copied, directory: target, approveStandard: approveStandard)
            try await importer.acknowledgeRegistration(id: copied.id)
            pendingImports = try await importer.pending()
            profiles = try await engine.profiles()
            await selectProfile(profile.id)
        } catch {
            self.error =
                (error as? FacetVaultImportError)?.errorDescription
                ?? "Import was interrupted. The original stays unchanged and the private copy is retained. "
                + FacetFailureDiagnostic(error).action
            do { pendingImports = try await importer.pending() } catch {
                reportNativeFailure(error)
            }
        }
    }
}
