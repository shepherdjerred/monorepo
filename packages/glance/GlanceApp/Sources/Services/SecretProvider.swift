import Foundation

// MARK: - SecretProvider

/// Retrieves secrets from an external provider.
protocol SecretProvider: Sendable {
    /// Read a secret by its reference string.
    func read(reference: String) async throws -> String
}

// MARK: - SecretError

/// Error types for secret retrieval.
enum SecretError: Error, CustomStringConvertible {
    case opReadFailed(reference: String, exitCode: Int32, stderr: String)
    case opNotFound
    case invalidOutput
    case notLoaded(reference: String)

    // MARK: Internal

    var description: String {
        switch self {
        case let .opReadFailed(reference, exitCode, stderr):
            "op failed for \(reference) (exit \(exitCode)): \(stderr)"
        case .opNotFound:
            "1Password CLI (op) not found"
        case .invalidOutput:
            "op returned empty or invalid output"
        case let .notLoaded(reference):
            "Secret not loaded: \(reference)"
        }
    }
}

// MARK: - SecretRefs

/// All secret references needed by the app.
/// Keys are logical names, values are `op read` reference strings.
enum SecretRefs {
    // MARK: Internal

    static let argoCD = "argocd"
    static let grafana = "grafana"
    static let bugsink = "bugsink"
    static let github = "github"
    static let buildkite = "buildkite"
    static let cloudflareToken = "cloudflare-token"
    static let cloudflareAccountId = "cloudflare-account-id"
    static let pagerDuty = "pagerduty"

    /// Map of logical key to op:// reference (using vault+item IDs).
    static let references: [(key: String, ref: String)] = [
        (argoCD, "op://\(homelabVault)/nfviaka4ibphb2aodeoeow46zq/ARGOCD_TOKEN"),
        (grafana, "op://\(k8sVault)/w5y6wldczvojkh3yxe5zadkpvi/password"),
        (bugsink, "op://\(personalVault)/76xqbj2znu6lkspwxhljuae554/credential"),
        (github, "op://\(k8sVault)/kjzy27cw4ialemerahutnxis3a/password"),
        (buildkite, "op://\(personalVault)/lmnwn2ul7qx3rdpzeenu5q7mau/credential"),
        (cloudflareToken, "op://\(k8sVault)/phno6uzitv2hl7isv36abr5kky/password"),
        (cloudflareAccountId, "op://\(personalVault)/txmgcbswnpbpsoun2mrc4i5doi/account id"),
        (pagerDuty, "op://\(personalVault)/PagerDuty API Token/credential"),
    ]

    // MARK: Private

    // Vault IDs (parentheses in names break op read)
    private static let homelabVault = "yx6je6mgj2oiss6z5bm42h3cxy"
    private static let k8sVault = "v64ocnykdqju4ui6j6pua56xw4"
    private static let personalVault = "63lcesgoblzbpkdr4koye66rei"
}

// MARK: - BatchSecretProvider

/// Fetches ALL secrets from 1Password in a single shell script invocation.
/// Uses `op read` calls within one script — after the first auth, subsequent
/// reads use the cached session (no additional biometric prompts).
final class BatchSecretProvider: SecretProvider, @unchecked Sendable {
    // MARK: Lifecycle

    init(opPath: String = "/opt/homebrew/bin/op") {
        self.opPath = opPath
    }

    // MARK: Internal

    /// Load all secrets. Call once at startup before polling.
    func loadAll() async {
        guard FileManager.default.fileExists(atPath: self.opPath) else {
            glanceLog("op not found at \(self.opPath)")
            return
        }

        // Build a bash script that calls `op read` for each reference
        // and outputs key\tvalue lines. All reads share the same session.
        var lines = ["#!/bin/bash"]
        for (key, ref) in SecretRefs.references {
            // Use op read with --no-newline, capture output
            lines
                .append(
                    "VAL=$(\"\(self.opPath)\" read \"\(ref)\" 2>/dev/null) && printf '%s\\t%s\\n' '\(key)' \"$VAL\" || printf '%s\\t\\n' '\(key)'",
                )
        }
        let script = lines.joined(separator: "\n")

        do {
            let result = try await runScript(script)
            guard let output = String(data: result, encoding: .utf8) else {
                return
            }

            for line in output.split(separator: "\n") {
                let parts = line.split(separator: "\t", maxSplits: 1)
                if parts.count == 2 {
                    let key = String(parts[0])
                    let value = String(parts[1])
                    if !value.isEmpty {
                        self.cache[key] = value
                    }
                }
            }

            glanceLog("Loaded \(self.cache.count)/\(SecretRefs.references.count) secrets from 1Password")
        } catch {
            glanceLog("Failed to load secrets: \(error)")
        }
    }

    func read(reference: String) async throws -> String {
        guard let value = cache[reference] else {
            throw SecretError.notLoaded(reference: reference)
        }
        return value
    }

    // MARK: Private

    private var cache: [String: String] = [:]
    private let opPath: String

    private func runScript(_ script: String) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/bin/bash")
                process.arguments = ["-c", script]

                let stdout = Pipe()
                let stderr = Pipe()
                process.standardOutput = stdout
                process.standardError = stderr

                do {
                    try process.run()
                } catch {
                    continuation.resume(throwing: SecretError.opNotFound)
                    return
                }

                process.waitUntilExit()

                // We don't fail on non-zero because individual op reads may fail
                let data = stdout.fileHandleForReading.readDataToEndOfFile()
                continuation.resume(returning: data)
            }
        }
    }
}

// MARK: - MockSecretProvider

/// Returns fixed values for testing.
struct MockSecretProvider: SecretProvider {
    // MARK: Lifecycle

    init(secrets: [String: String] = [:]) {
        self.secrets = secrets
    }

    // MARK: Internal

    func read(reference: String) async throws -> String {
        guard let value = secrets[reference] else {
            throw SecretError.opReadFailed(reference: reference, exitCode: 1, stderr: "mock")
        }
        return value
    }

    // MARK: Private

    private let secrets: [String: String]
}
