// ⚠️ TEMPORARY. This file is the `/v2` wire boundary, and it does not belong
// in Swift.
//
// `tasknotes-core` already owns it — `crates/tasknotes-core/src/domain/wire.rs`
// has `WireTask`, `WIRE_FIELD_RENAMES`, `create_task_body`, `update_task_body`
// and `unwrap_envelope`, all tested against the shared fixtures. **None of it
// is exported over the FFI.** The `TaskApi` foreign trait hands the host a
// `CreateTaskRequest` and expects a `Task` back, so the host is left holding
// the one part of the boundary the core did not export — and every future
// binding (C# next) will have to write this same file unless the core exports
// it.
//
// It is deliberately the smallest possible transcription — a rename table, an
// id derivation, and an envelope unwrap — and every one of those is a direct
// quote of the Rust. Delete the whole file the moment the core exports
// `wire_task_from_json` / `create_task_body` / `update_task_body` /
// `unwrap_envelope`.
//
// ⚠️ **It has one known limitation that the Rust does not**, and it is the
// clearest argument for deleting it: `serde_json` is configured with
// `preserve_order` and the core stores `extraFields` in an `IndexMap`, so a
// task's unmodelled frontmatter keys keep the order the vault wrote them in.
// Foundation's `JSONSerialization` has no ordered dictionary, so any task
// carrying `customProperties` loses that order on the way through here. For a
// client that writes frontmatter back, that is a real (if cosmetic) mutation of
// the user's file, and it cannot be fixed inside Swift — only by moving the
// boundary back into the core, where it already works.

public import TaskNotesUniFFI

internal import struct Foundation.Data
internal import class Foundation.JSONSerialization
internal import class Foundation.NSNull

/// A JSON object as the `/v2` endpoints exchange it.
///
/// Named rather than spelled out at every signature, because
/// `[String: Any]` pushes these declarations past the formatter's line length
/// and the resulting brace placement then fights SwiftLint's `opening_brace`.
public typealias WireFields = [String: Any]

/// The `/v2` wire vocabulary, translated to and from the core's domain
/// vocabulary.
public enum WireBridge {
    /// The complete domain-to-wire field rename table.
    ///
    /// Four entries, and the only four — a direct transcription of
    /// `WIRE_FIELD_RENAMES`. Everything else is spelled identically on both
    /// sides, which is why this is a lookup and not a case transform:
    /// snake-casing an outbound payload wholesale would rename ten fields the
    /// server does not recognise.
    public static let fieldRenames: [(domain: String, wire: String)] = [
        ("recurrenceAnchor", "recurrence_anchor"),
        ("completeInstances", "complete_instances"),
        ("skippedInstances", "skipped_instances"),
        ("extraFields", "customProperties"),
    ]

    // ── Inbound ────────────────────────────────────────────────────────────

    /// Unwrap the `{ success, data, error }` envelope the server's middleware
    /// applies.
    ///
    /// Returns the inner payload when the envelope says success, and the body
    /// untouched when it is not an envelope at all — which is the reference
    /// client's behaviour, since most endpoints answer with a bare payload.
    ///
    /// An envelope failure raises `CoreError.Api` with status `0`. The zero is
    /// deliberate and matches the core: an envelope failure carries no HTTP
    /// status of its own, and inventing one would make the sync layer's
    /// classifier retry or dead-letter on a fiction.
    public static func unwrapEnvelope(_ body: Any) throws(CoreError) -> Any {
        guard
            let object = body as? [String: Any],
            let success = object["success"] as? Bool
        else { return body }

        guard success else {
            let message = object["error"] as? String
            throw CoreError.Api(message: message ?? "API returned success=false", status: 0)
        }
        return object["data"] ?? NSNull()
    }

    /// Convert one wire task object into the core's `CoreTask`.
    ///
    /// Validation is entirely the core's: this applies the rename table and the
    /// path-as-id rule, then hands the result to `taskFromJson`, which is where
    /// ids, project names, contexts, tags, statuses and priorities are actually
    /// parsed.
    public static func task(fromWire object: [String: Any]) throws(CoreError) -> CoreTask {
        var domain: [String: Any] = [:]
        for (key, value) in object {
            let renamed = fieldRenames.first { $0.wire == key }
            domain[renamed?.domain ?? key] = value
        }

        // Path-as-id. `id`, when present, equals the path anyway; it is only a
        // fallback for the one endpoint that omits `path`. An empty result is
        // left empty so the core rejects it, rather than being papered over
        // here where the failure would be invisible.
        let path = object["path"] as? String
        let fallback = object["id"] as? String
        domain["id"] = (path?.isEmpty == false ? path : fallback) ?? ""

        return try task(fromDomainJSON: try json(from: domain))
    }

    /// Convert a wire task list page.
    public static func tasks(fromWire array: [Any]) throws(CoreError) -> [CoreTask] {
        var converted: [CoreTask] = []
        converted.reserveCapacity(array.count)
        for element in array {
            guard let object = element as? [String: Any] else {
                throw CoreError.Validation(message: "a task list entry was not a JSON object")
            }
            converted.append(try task(fromWire: object))
        }
        return converted
    }

    // ── Outbound ───────────────────────────────────────────────────────────

    /// Render a create payload as the wire body to POST.
    ///
    /// Built field by field rather than by serializing the record, because the
    /// core exports no `CreateTaskRequest` serializer yet — unlike
    /// `UpdateTaskRequest`, which has `updateTaskRequestToJson` and is therefore
    /// handled by ``body(forUpdate:)`` without restating anything.
    ///
    /// An absent field is omitted entirely, matching `skip_serializing_if` on
    /// every optional in the core's `CreateTaskRequest`. There is no
    /// present-but-null state on a create: `null` is the server's instruction to
    /// delete a frontmatter key, which only an update can mean.
    public static func body(forCreate request: CreateTaskRequest) throws(CoreError) -> WireFields {
        var fields: [String: Any] = ["title": request.title]

        // A local `func` rather than thirteen `if let`s, and rather than
        // `fields[key] = optional`: assigning an `Optional` through a
        // `[String: Any]` subscript is the classic double-wrapping trap, where
        // a `nil` can end up stored as a present `Optional.none` boxed in
        // `Any` instead of removing the key.
        func set(_ key: String, _ value: Any?) {
            guard let value else { return }
            fields[key] = value
        }

        set("details", request.details)
        set("status", request.status.map { taskStatusWireValue(status: $0) })
        set("priority", request.priority.map { priorityWireValue(priority: $0) })
        set("due", request.due)
        set("scheduled", request.scheduled)
        set("contexts", request.contexts)
        set("projects", request.projects)
        set("tags", request.tags)
        set("recurrence", request.recurrence)
        set("recurrenceAnchor", request.recurrenceAnchor.map(wireValue(forAnchor:)))
        set("timeEstimate", request.timeEstimate)
        if let extra = request.extraFields {
            set("extraFields", try object(fromJSON: extra, describing: "extraFields"))
        }
        return toWireFields(fields)
    }

    /// Render a partial update as the wire body to PUT.
    ///
    /// The three-state `unchanged` / `clear` / `set` distinction is the core's
    /// and stays there: `updateTaskRequestToJson` omits an unchanged field
    /// entirely and renders a cleared one as an explicit `null`, which is the
    /// server's instruction to delete the frontmatter key.
    public static func body(forUpdate request: UpdateTaskRequest) throws(CoreError) -> WireFields {
        let rendered = try CoreErrors.rethrowingCore("could not render a task update") {
            try updateTaskRequestToJson(request: request)
        }
        return toWireFields(try object(fromJSON: rendered, describing: "a task update"))
    }

    /// Rename the domain field names in an outbound payload to their wire
    /// spellings.
    public static func toWireFields(_ fields: WireFields) -> WireFields {
        var wire: [String: Any] = [:]
        for (key, value) in fields {
            let renamed = fieldRenames.first { $0.domain == key }
            wire[renamed?.wire ?? key] = value
        }
        return wire
    }

    // ── JSON plumbing ──────────────────────────────────────────────────────

    /// Parse a response body, with the transport's own framing already removed.
    ///
    /// `internal` rather than `public`: `Data` is Foundation's, and keeping it
    /// out of this module's public surface is what lets every Foundation import
    /// in this file stay `internal` — which `InternalImportsByDefault` makes a
    /// visible, checked property rather than a habit.
    internal static func value(fromJSON data: Data) throws(CoreError) -> Any {
        try CoreErrors.validating("the server sent a body that is not JSON") {
            try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        }
    }

    /// Serialize a request body.
    internal static func data(fromJSON value: Any) throws(CoreError) -> Data {
        try CoreErrors.validating("a request body could not be serialized") {
            try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        }
    }

    private static func json(from value: Any) throws(CoreError) -> String {
        try data(fromJSON: value).decodedAsUtf8(describing: "a serialized payload")
    }

    private static func task(fromDomainJSON text: String) throws(CoreError) -> CoreTask {
        try CoreErrors.rethrowingCore("could not parse a task") {
            try taskFromJson(json: text)
        }
    }

    private static func object(
        fromJSON text: String,
        describing what: String
    ) throws(CoreError) -> [String: Any] {
        let parsed = try value(fromJSON: Data(text.utf8))
        guard let object = parsed as? [String: Any] else {
            throw CoreError.Validation(message: "\(what) must be a JSON object")
        }
        return object
    }

    /// The wire spelling of a recurrence anchor.
    ///
    /// Spelled out rather than derived: the core exports wire values for
    /// statuses and priorities but not for this enum, and an exhaustive switch
    /// is what makes adding a third anchor a compile error here.
    private static func wireValue(forAnchor anchor: RecurrenceAnchor) -> String {
        switch anchor {
        case .scheduled: "scheduled"
        case .completion: "completion"
        }
    }
}
