//! Versioned native-facing data with open workflow values and preserved properties.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Explicit whole-text adapter used by pure Markdown/configuration planners.
/// Binary files use immutable images and never enter this assembly boundary.
/// This does not claim collection-independent or whole-note memory bounds.
///
/// # Errors
/// Rejects binary paths, unsafe paths, corrupt snapshots and capability errors.
pub fn read_text_file<F: VaultFiles + ?Sized>(
    files: &F,
    profile: &str,
    path: &str,
) -> Result<Option<Vec<u8>>> {
    tasknotes_vault::path::VaultPath::parse(path)?;
    let extension = std::path::Path::new(path)
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .map(str::to_ascii_lowercase);
    if extension
        .as_deref()
        .is_none_or(|extension| !["md", "json", "yaml", "yml"].contains(&extension))
    {
        return Err(crate::RuntimeError::Validation(
            "task/configuration text reads do not accept binary file paths".to_owned(),
        ));
    }
    let Some(snapshot) = files.open_file_snapshot(profile, path)? else {
        return Ok(None);
    };
    let result = (|| {
        if snapshot.id.is_empty()
            || snapshot.id.len() > 256
            || snapshot.id.chars().any(char::is_control)
            || snapshot.revision.len() != 64
            || !snapshot
                .revision
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(crate::RuntimeError::HostContract(
                "invalid immutable text snapshot".to_owned(),
            ));
        }
        let size = usize::try_from(snapshot.size).map_err(|_| {
            crate::RuntimeError::Host("text image exceeds addressable range".to_owned())
        })?;
        let mut bytes = Vec::new();
        bytes.try_reserve_exact(size).map_err(|_| {
            crate::RuntimeError::Host("text image allocation unavailable".to_owned())
        })?;
        let mut offset = 0;
        while offset < size {
            let length = (size - offset).min(PAYLOAD_CHUNK_BYTES);
            let chunk = files.read_snapshot_chunk(
                profile,
                &snapshot.id,
                u64::try_from(offset)
                    .map_err(|_| crate::RuntimeError::Host("invalid text offset".to_owned()))?,
                u32::try_from(length)
                    .map_err(|_| crate::RuntimeError::Host("invalid text chunk".to_owned()))?,
            )?;
            if chunk.len() != length {
                return Err(crate::RuntimeError::HostContract(
                    "text snapshot returned an inexact chunk".to_owned(),
                ));
            }
            bytes.extend_from_slice(&chunk);
            offset += length;
        }
        if tasknotes_vault::document::ContentRevision::of(&bytes).as_str() != snapshot.revision {
            return Err(crate::RuntimeError::HostContract(
                "text snapshot digest mismatch".to_owned(),
            ));
        }
        Ok(Some(bytes))
    })();
    let closed = files.close_snapshot(profile, &snapshot.id);
    match (result, closed) {
        (Ok(bytes), Ok(())) => Ok(bytes),
        (Err(error), _) | (_, Err(error)) => Err(error),
    }
}

use crate::Result;

/// Maximum copied file chunk at the standalone binary capability boundary.
pub const PAYLOAD_CHUNK_BYTES: usize = 1024 * 1024;

/// Lifecycle of an immutable incoming transfer payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PayloadState {
    /// Contiguous chunks are still being durably staged.
    Preparing,
    /// Size and SHA256 have been verified and writes are immutable.
    Sealed,
    /// Explicit disposition released bytes; this identity cannot be reused.
    Discarded,
}

/// Nonsecret, metadata-only receipt for bounded `SQLite` payload staging.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PayloadInfo {
    /// Stable caller identity scoped to its owning profile.
    pub id: String,
    /// Exact immutable declared byte count.
    pub size: u64,
    /// Expected lowercase SHA256 of the complete payload.
    pub revision: String,
    /// Exact durable contiguous prefix length.
    pub written: u64,
    /// Current staging/disposition state.
    pub state: PayloadState,
}

impl PayloadInfo {
    /// Validate metadata without loading any image bytes. Relational prefix
    /// constraints supplement the neutral JSON Schema's structural bounds.
    ///
    /// # Errors
    /// Rejects unsafe identity, invalid hash, size/prefix or lifecycle metadata.
    pub fn validate_contract(&self) -> crate::Result<()> {
        if self.id.trim().is_empty()
            || self.id.len() > 256
            || self.id.chars().any(char::is_control)
            || self.size > u64::from(i32::MAX.unsigned_abs())
            || self.written > self.size
            || (self.state == PayloadState::Sealed && self.written != self.size)
            || self.revision.len() != 64
            || !self
                .revision
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(crate::RuntimeError::Validation(
                "invalid bounded payload metadata".to_owned(),
            ));
        }
        Ok(())
    }
}

/// Durable owner slot pointing to one immutable binary payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PayloadRole {
    /// Current indexed vault file image.
    File,
    /// Last authenticated/acknowledged remote base image.
    Base,
    /// Original journal image retained for CAS and Undo.
    JournalBefore,
    /// Immutable journal replacement image.
    JournalAfter,
    /// Immutable queued service upload receipt.
    Outbox,
    /// Common ancestor of a preserved overlap.
    ConflictBase,
    /// Local side of a preserved overlap.
    ConflictLocal,
    /// Remote/captured side of a preserved overlap.
    ConflictRemote,
    /// Archived conflict ancestor retained after its resolution.
    ArchiveBase,
    /// Archived local side retained after its resolution.
    ArchiveLocal,
    /// Archived remote side retained after its resolution.
    ArchiveRemote,
    /// Authenticated remote image pending journal application.
    RemoteBase,
    /// Current incomplete refresh generation's captured image.
    Refresh,
}

/// Filesystem capabilities, implemented by each native host.
pub trait VaultFiles: Send + Sync {
    /// Capture a bounded immutable file image; no binary byte array is returned.
    ///
    /// # Errors
    /// Returns provider/access failure, including unsupported snapshot capability.
    fn open_file_snapshot(&self, _profile: &str, _path: &str) -> Result<Option<FileSnapshot>> {
        Err(crate::RuntimeError::Host(
            "provider does not support immutable file snapshots".to_owned(),
        ))
    }
    /// Open one retained predecessor as an immutable bounded snapshot.
    ///
    /// # Errors
    /// Returns missing/corrupt/wrong-owner or unsupported capability failures.
    fn open_displaced_snapshot(&self, _profile: &str, _backup: &str) -> Result<FileSnapshot> {
        Err(crate::RuntimeError::Host(
            "provider does not support retained snapshots".to_owned(),
        ))
    }
    /// Read an exact range of at most one MiB, including zero bytes at EOF.
    ///
    /// # Errors
    /// Returns ownership, lifetime, range or provider failures.
    fn read_snapshot_chunk(
        &self,
        _profile: &str,
        _snapshot: &str,
        _offset: u64,
        _length: u32,
    ) -> Result<Vec<u8>> {
        Err(crate::RuntimeError::Host(
            "provider does not support bounded snapshot reads".to_owned(),
        ))
    }
    /// Release only a temporary snapshot, retaining any durable predecessor.
    ///
    /// # Errors
    /// Returns wrong-owner/unknown handles or provider cleanup failure.
    fn close_snapshot(&self, _profile: &str, _snapshot: &str) -> Result<()> {
        Err(crate::RuntimeError::Host(
            "provider does not support snapshot retirement".to_owned(),
        ))
    }
    /// Resume one durable immutable operation intent and committed prefix.
    ///
    /// # Errors
    /// Returns changed intent, owner, unsupported durability or provider failures.
    fn begin_replacement(
        &self,
        _profile: &str,
        _operation: &str,
        _path: &str,
        _expected: Option<&str>,
        _size: u64,
        _revision: &str,
    ) -> Result<ReplacementStage> {
        Err(crate::RuntimeError::Host(
            "provider does not support staged replacement".to_owned(),
        ))
    }
    /// Commit one contiguous bounded chunk or verify an exact prefix retry.
    ///
    /// # Errors
    /// Returns changed/gapped/overlapping chunks or provider durability failures.
    fn write_replacement_chunk(
        &self,
        _profile: &str,
        _stage: &str,
        _offset: u64,
        _bytes: &[u8],
    ) -> Result<ReplacementStage> {
        Err(crate::RuntimeError::Host(
            "provider does not support staged writes".to_owned(),
        ))
    }
    /// Verify exact size/hash and durably seal the private immutable source.
    ///
    /// # Errors
    /// Returns incomplete/corrupt/unknown stages or provider durability failure.
    fn seal_replacement(&self, _profile: &str, _stage: &str) -> Result<ReplacementStage> {
        Err(crate::RuntimeError::Host(
            "provider does not support stage sealing".to_owned(),
        ))
    }
    /// Exchange one durable staged intent or replay its exact recorded outcome.
    ///
    /// # Errors
    /// Returns owner/intent/atomicity or recovery failures; no unsupported fallback.
    fn compare_exchange_staged(
        &self,
        _profile: &str,
        _operation: &str,
        _path: &str,
        _expected: Option<&str>,
        _stage: Option<&str>,
    ) -> Result<StagedExchange> {
        Err(crate::RuntimeError::Host(
            "provider does not support staged atomic exchange".to_owned(),
        ))
    }
    /// Retire source bytes after durable engine disposition, preserving receipts.
    ///
    /// # Errors
    /// Returns unknown/wrong-owner stage or durability failures.
    fn discard_replacement(&self, _profile: &str, _stage: &str) -> Result<()> {
        Err(crate::RuntimeError::Host(
            "provider does not support staged retirement".to_owned(),
        ))
    }
    /// Enumerate logical files, excluding host backups and application state.
    ///
    /// # Errors
    /// Returns capability, permission, or provider failures.
    fn list_files(&self, profile_id: &str) -> Result<Vec<String>>;
    /// Read exact bytes, or report absence; access failures must be errors.
    ///
    /// # Errors
    /// Returns capability, permission, or provider failures.
    fn read_file(&self, profile_id: &str, path: &str) -> Result<Option<Vec<u8>>> {
        read_text_file(self, profile_id, path)
    }
    /// Atomically capture displaced bytes when replacing/deleting a file.
    /// A missing expected revision permits creation only when absent.
    /// Backups remain durable until `acknowledge_displaced` succeeds.
    ///
    /// # Errors
    /// Returns unsupported atomic capabilities or durable I/O failures.
    fn compare_exchange(
        &self,
        profile_id: &str,
        path: &str,
        expected_revision: Option<&str>,
        replacement: Option<&[u8]>,
    ) -> Result<FileExchange> {
        let _ = (profile_id, path, expected_revision, replacement);
        Err(crate::RuntimeError::Host(
            "inline file exchange has been retired".to_owned(),
        ))
    }
    /// Recover durable displaced files after process termination.
    ///
    /// # Errors
    /// Returns unavailable/corrupt backup storage failures.
    fn displaced_metadata(
        &self,
        profile_id: &str,
        after_id: Option<&str>,
        limit: u32,
    ) -> Result<Vec<DisplacedMetadata>>;
    /// Read one immutable retained backup, without loading a backlog.
    ///
    /// # Errors
    /// Returns unavailable, corrupt, or missing backup failures.
    fn read_displaced(&self, profile_id: &str, id: &str) -> Result<Vec<u8>> {
        let _ = (profile_id, id);
        Err(crate::RuntimeError::Host(
            "inline predecessor reads have been retired".to_owned(),
        ))
    }
    /// Remove a host backup after the engine has durably retained it.
    ///
    /// # Errors
    /// Returns backup permission, identity, or durable I/O failures.
    fn acknowledge_displaced(&self, profile_id: &str, id: &str) -> Result<()>;
}

/// Opaque profile/engine-lifetime image handle with exact captured metadata.
#[derive(Debug, Clone)]
pub struct FileSnapshot {
    /// Verified opaque host identity; never interpreted as a path.
    pub id: String,
    /// Exact captured byte count.
    pub size: u64,
    /// Exact lowercase SHA256.
    pub revision: String,
}

/// Durable staged replacement metadata; source stays private through exchange.
#[derive(Debug, Clone)]
pub struct ReplacementStage {
    /// Opaque persistent host stage identity.
    pub id: String,
    /// Exact facet-write:64lowerhex operation identity.
    pub operation_id: String,
    /// Validated logical destination.
    pub path: String,
    /// Exact immutable target size.
    pub size: u64,
    /// Exact lowercase target SHA256.
    pub revision: String,
    /// Durably committed contiguous prefix.
    pub written: u64,
    /// Immutable source is verified and ready.
    pub sealed: bool,
}

/// Exact recorded exchange result with metadata-only retained predecessor.
#[derive(Debug, Clone)]
pub struct StagedExchange {
    /// Whether the filesystem operation was actually applied.
    pub applied: bool,
    /// Actual retained predecessor, including external-writer races.
    pub displaced: Option<DisplacedMetadata>,
}

/// Result of a coordinated atomic filesystem operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileExchange {
    /// Whether replacement/deletion actually occurred.
    pub applied: bool,
    /// Exact displaced bytes, including a competing writer's update.
    pub displaced_bytes: Option<Vec<u8>>,
    /// Durable host backup identity; required for any displaced bytes.
    pub displaced_version_id: Option<String>,
}

/// Captured filesystem version awaiting durable engine acknowledgement.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplacedVersion {
    /// Stable backup identity across process relaunch.
    pub id: String,
    /// Logical source path.
    pub path: String,
    /// Exact captured content.
    pub bytes: Vec<u8>,
}

/// Bounded metadata enumeration for durable provider backups.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplacedMetadata {
    /// Stable backup identity, used as the exclusive ordered page cursor.
    pub id: String,
    /// Logical source path.
    pub path: String,
    /// Exact captured payload byte count.
    pub size: u64,
    /// Immutable SHA256 payload revision.
    pub revision: String,
}

/// Storage model of a profile; direct Sync never targets an external folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileKind {
    /// User-selected external provider/folder.
    LocalFolder,
    /// Facet-owned app-private Obsidian Sync replica.
    ObsidianSync,
}

/// Portable profile metadata, excluding credentials and device paths.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    /// Stable host-assigned identity.
    pub id: String,
    /// User-facing name.
    pub name: String,
    /// Capability category.
    pub kind: ProfileKind,
    /// Explicit consent to standard configuration in an unconfigured vault.
    pub approve_standard: bool,
}

/// A task projection retaining arbitrary physical/semantic fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[expect(
    clippy::struct_excessive_bools,
    reason = "Independent normative facts in a shared wire DTO, not mutually exclusive states"
)]
pub struct TaskSnapshot {
    /// Stable logical identity; renames change it.
    pub id: String,
    /// Vault-relative Markdown path.
    pub path: String,
    /// Configured display title.
    pub title: String,
    /// Open configured status value.
    pub status: String,
    /// Open configured priority value.
    pub priority: String,
    /// Configured completion meaning.
    pub completed: bool,
    /// Exact content revision for optimistic concurrency.
    pub revision: String,
    /// Role-normalized frontmatter including unknown fields.
    pub properties: Map<String, Value>,
    /// Exact Markdown body.
    pub body: String,
    /// Valid recurrence rule exists on the base task.
    #[serde(default)]
    pub is_recurring: bool,
    /// At least one unresolved dependency under configured status meanings.
    #[serde(default)]
    pub is_blocked: bool,
    /// Another task has an unresolved dependency on this task.
    #[serde(default)]
    pub is_blocking: bool,
    /// A time entry is open, independent of whether a read clock was supplied.
    #[serde(default)]
    pub has_active_time_session: bool,
    /// Per-entry rounded minutes; live entries require Query.at.
    #[serde(default)]
    pub total_tracked_minutes: u64,
    /// Instance represented by a recurrence-aware date query.
    #[serde(default)]
    pub occurrence_date: Option<String>,
    /// Shared effective civil day used for ordering and grouping.
    #[serde(default)]
    pub effective_date: Option<String>,
    /// This exact task path has a durable unacknowledged upload.
    #[serde(default)]
    pub is_pending: bool,
}

/// Nonfatal indexing diagnostic requiring user attention.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProblem {
    /// Logical affected path.
    pub path: String,
    /// Sanitized diagnostic without note contents.
    pub message: String,
}

/// Durable, paged UI state for one profile.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Owning profile identity.
    pub profile_id: String,
    /// Monotonically increasing durable state version.
    pub version: u64,
    /// Matching page of tasks.
    pub tasks: Vec<TaskSnapshot>,
    /// Total tasks matching filters before pagination.
    pub total_count: u64,
    /// Unacknowledged upload count.
    pub pending_count: u64,
    /// All indexed task paths with unacknowledged uploads; contains no payloads.
    pub pending_task_ids: Vec<String>,
    /// Unresolved conflict count.
    pub conflict_count: u64,
    /// Effective TaskNotes settings, including custom workflows.
    pub configuration: Value,
    /// Indexing failures retained until their files are corrected.
    pub problems: Vec<FileProblem>,
    /// Portable saved views stored as Markdown documents.
    pub views: Vec<SavedView>,
    /// Shared grouping result over the returned page.
    pub groups: Vec<TaskGroup>,
}

/// Portable view envelope; unknown preference keys round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedView {
    /// Stable view identity.
    pub id: String,
    /// Shared versioned view definition.
    pub view: Map<String, Value>,
    /// Exact document revision.
    pub revision: String,
}

/// Group membership computed by the shared engine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGroup {
    /// Semantic grouping key; civil dates remain unformatted.
    pub key: String,
    /// Member logical identities.
    pub task_ids: Vec<String>,
}

/// Query uses open workflow strings, not app-specific enum assumptions.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Query {
    /// Page offset.
    #[serde(default)]
    pub offset: u32,
    /// Page size, capped at 1,000.
    pub limit: Option<u32>,
    /// Case-insensitive title/body substring.
    pub text: Option<String>,
    /// Allowed status values; absent means all.
    pub statuses: Option<Vec<String>>,
    /// Allowed priority values; absent means all.
    pub priorities: Option<Vec<String>>,
    /// Filter by configured completion state.
    pub completed: Option<bool>,
    /// Include archived tasks.
    #[serde(default)]
    pub include_archived: bool,
    /// Built-in scope: all, today, upcoming, overdue, completed, undated, or inbox.
    pub scope: Option<String>,
    /// Caller-supplied local civil date for date scopes and recurrence.
    pub today: Option<String>,
    /// Explicit read instant for elapsed live time; absent excludes live minutes.
    pub at: Option<String>,
    /// Days ahead in upcoming scope; default seven.
    pub upcoming_days: Option<u32>,
    /// Project values, matched using the shared wikilink identity rules.
    pub projects: Option<Vec<String>>,
    /// Context values.
    pub contexts: Option<Vec<String>>,
    /// Tags without leading hashes.
    pub tags: Option<Vec<String>>,
    /// Require absence of a due date.
    pub has_no_due_date: Option<bool>,
    /// Require absence of project values.
    pub has_no_project: Option<bool>,
    /// Exclusive due-date upper bound.
    pub due_before: Option<String>,
    /// Exclusive due-date lower bound.
    pub due_after: Option<String>,
    /// Sort field: title, priority, status, dueDate, effectiveDate, or manual.
    pub sort_field: Option<String>,
    /// Sort direction: asc or desc.
    pub sort_direction: Option<String>,
    /// Group field: status, priority, project, context, or effectiveDate.
    pub group_by: Option<String>,
}

/// Caller-created idempotent command envelope.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mutation {
    /// Stable retry identity. Reuse with different payload is rejected.
    pub mutation_id: String,
    /// Caller-supplied RFC3339 timestamp; domain code never reads a clock.
    pub at: String,
    /// Explicit local calendar context; absent uses the timestamp's written day.
    #[serde(default)]
    pub execution_context: Option<ExecutionContext>,
    /// Requested semantic operation.
    pub command: Command,
}

/// Clock/calendar input supplied by the native host, without ambient locale reads.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecutionContext {
    /// Local canonical civil day at the mutation instant.
    pub today: String,
    /// IANA timezone used to validate and resolve the local calendar day.
    pub timezone: String,
}

/// Exact immutable conflict and current-file revision fences.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConflictRevisions {
    /// Original common version; null denotes no file.
    #[serde(deserialize_with = "required_nullable_revision")]
    pub base: Option<String>,
    /// Preserved local version; null denotes a deletion.
    #[serde(deserialize_with = "required_nullable_revision")]
    pub local: Option<String>,
    /// Preserved remote version; null denotes a deletion.
    #[serde(deserialize_with = "required_nullable_revision")]
    pub remote: Option<String>,
    /// Displayed current destination; null denotes no file.
    #[serde(deserialize_with = "required_nullable_revision")]
    pub current: Option<String>,
}

fn required_nullable_revision<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

impl ConflictRevisions {
    fn validate(&self) -> crate::Result<()> {
        for revision in [&self.base, &self.local, &self.remote, &self.current]
            .into_iter()
            .flatten()
        {
            if revision.len() != 64
                || !revision
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            {
                return Err(crate::RuntimeError::Validation(
                    "conflict revisions must be lowercase SHA-256".to_owned(),
                ));
            }
        }
        Ok(())
    }
}

/// Resolution policy without binary file contents in JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ResolutionChoice {
    /// Retain the exact local preserved bytes or tombstone.
    KeepLocal {},
    /// Retain the exact remote preserved bytes or tombstone.
    KeepRemote {},
    /// Copy local bytes to an absent safe destination, retaining remote at source.
    KeepBoth {
        /// New logical vault path.
        new_path: String,
    },
    /// Apply explicit bytes from the typed binary channel, or a tombstone.
    ReplacePayload {
        /// True requires absent payload; false requires bytes, including empty bytes.
        deleted: bool,
    },
}

/// Semantic task and view commands over one durable profile.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    /// Explicitly normalize known aliases and datetime spelling.
    Normalize {
        /// Current logical task path.
        path: String,
        /// Optional optimistic revision fence.
        expected_revision: Option<String>,
    },
    /// Execute independent items with durable per-item outcomes, allowing partial success.
    BatchPartial {
        /// Ordered ordinary commands; empty batches are valid.
        commands: Vec<Command>,
    },
    /// Rename and optionally retarget all unambiguous collection references.
    RenameReferences {
        /// Current logical path.
        path: String,
        /// Safe unused destination.
        new_path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
        /// Preserve references by planning their changes in the same journal.
        update_references: bool,
    },
    /// Delete with an explicit backlink safety decision.
    DeleteChecked {
        /// Current logical path.
        path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
        /// Inspect collection references before deleting.
        check_backlinks: bool,
        /// Explicitly permit deletion with incoming references.
        force: bool,
    },
    /// Resolve preserved versions as an immutable caller-owned mutation.
    ResolveConflict {
        /// Stable conflict inbox identity.
        conflict_id: String,
        /// All preserved versions and the currently displayed file revision.
        expected_revisions: ConflictRevisions,
        /// Selected disposition; replacement content uses the binary channel.
        resolution: ResolutionChoice,
    },
    /// Change one device's private durable focus timer.
    Pomodoro {
        /// Device-owned secure installation identity; never synchronized.
        device_id: String,
        /// start, pause, resume, or stop.
        action: String,
        /// Optional associated logical task.
        task_path: Option<String>,
        /// Focus interval seconds; omitted uses configured work duration.
        duration_seconds: Option<u64>,
    },
    /// Persist portable view order without replacing preference maps.
    ReorderViews {
        /// Complete desired ordering of currently saved views.
        ids: Vec<String>,
    },
    /// Restore built-in portable definitions, retaining custom views.
    RestoreDefaultViews {},
    /// Apply independent file commands as one durable journal and undo unit.
    Batch {
        /// Non-nested commands with distinct target paths.
        commands: Vec<Command>,
    },
    /// Restore the exact versions captured by a committed mutation.
    Undo {
        /// Original durable mutation identity.
        receipt_id: String,
    },
    /// Set completion absolutely, including an explicit recurrence instance.
    SetCompletion {
        /// Current logical path.
        path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
        /// Desired configured completion meaning.
        completed: bool,
        /// Selected local civil occurrence date.
        occurrence_date: Option<String>,
    },
    /// Set a recurring day's skip membership absolutely without advancing its anchor.
    SetOccurrenceSkipped {
        /// Current logical task path.
        path: String,
        /// Optional optimistic content revision.
        expected_revision: Option<String>,
        /// Explicit local civil day, including days outside current rule generation.
        occurrence_date: String,
        /// True skips; false removes skip membership only.
        skipped: bool,
    },
    /// Begin a task's durable time entry.
    StartTime {
        /// Current logical path.
        path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
    },
    /// Finish the task's active time entry.
    StopTime {
        /// Current logical path.
        path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
    },
    /// Replace validated time entries, preserving arbitrary entry properties.
    SetTimeEntries {
        /// Current logical path.
        path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
        /// Entries use upstream startTime/endTime/duration names.
        entries: Vec<Map<String, Value>>,
    },
    /// Create a task, applying defaults and configured detection.
    Create {
        /// Optional explicit safe path; otherwise derive from title.
        path: Option<String>,
        /// Semantic role values, including custom fields.
        properties: Map<String, Value>,
        /// New Markdown body.
        body: Option<String>,
    },
    /// Update selected properties, preserving all other source bytes.
    Update {
        /// Current path.
        path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
        /// Null removes a property; omitted fields remain unchanged.
        properties: Map<String, Value>,
        /// Explicit body replacement.
        body: Option<String>,
    },
    /// Atomically edit a task and apply a named configured status transition.
    EditTask {
        /// Current path, fenced once for the complete operation.
        path: String,
        /// Optional optimistic revision of the loaded original document.
        expected_revision: Option<String>,
        /// Non-status changes; null removes a field and omitted fields remain unchanged.
        properties: Map<String, Value>,
        /// Explicit body replacement; null or absence leaves the body unchanged.
        body: Option<String>,
        /// Optional configured transition, including completion and time-stop semantics.
        status: Option<String>,
        /// Displayed recurring occurrence; absence uses the immutable mutation civil day.
        occurrence_date: Option<String>,
    },
    /// Delete a task without discarding concurrent changes.
    Delete {
        /// Current path.
        path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
    },
    /// Set an exact configured status.
    SetStatus {
        /// Current path.
        path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
        /// Configured value.
        status: String,
        /// Projected recurring date; absent uses the immutable mutation civil day.
        #[serde(default)]
        occurrence_date: Option<String>,
    },
    /// Complete/uncomplete a task or a selected recurring occurrence.
    ToggleComplete {
        /// Current path.
        path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
        /// Civil occurrence date; required for recurring instance selection.
        occurrence_date: Option<String>,
    },
    /// Journal source-preserving creation then deletion.
    Rename {
        /// Current path.
        path: String,
        /// Safe unused destination.
        new_path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
    },
    /// Set task archive state.
    Archive {
        /// Current path.
        path: String,
        /// Optional optimistic revision.
        expected_revision: Option<String>,
        /// Desired archive state.
        archived: bool,
    },
    /// Create/update a portable saved view.
    SaveView {
        /// Stable filename-safe view identity.
        id: String,
        /// Shared schema document.
        view: Map<String, Value>,
    },
    /// Delete a saved view.
    DeleteView {
        /// Stable view identity.
        id: String,
    },
}

impl Command {
    /// Validate collection constraints from the shared boundary schema.
    ///
    /// # Errors
    /// Rejects nested/empty/oversized batches and duplicate view ordering keys.
    pub fn validate_contract(&self) -> crate::Result<()> {
        if let Self::EditTask { properties, .. } = self
            && properties.contains_key("status")
        {
            return Err(crate::RuntimeError::Validation(
                "edit_task status must use its named status field".to_owned(),
            ));
        }
        self.validate_completion_target()?;
        match self {
            Self::SetOccurrenceSkipped {
                occurrence_date: date,
                ..
            } => {
                tasknotes_vault::temporal::parse_day(date)?;
            }
            Self::ResolveConflict {
                conflict_id,
                expected_revisions,
                resolution,
            } => {
                if conflict_id.is_empty()
                    || conflict_id.len() > 1024
                    || conflict_id.chars().any(char::is_control)
                {
                    return Err(crate::RuntimeError::Validation(
                        "invalid conflict identity".to_owned(),
                    ));
                }
                expected_revisions.validate()?;
                if let ResolutionChoice::KeepBoth { new_path } = resolution {
                    tasknotes_vault::path::VaultPath::parse(new_path)?;
                }
            }
            Self::BatchPartial { commands } => {
                if commands.len() > 1_000
                    || commands.iter().any(|command| {
                        matches!(
                            command,
                            Self::Batch { .. }
                                | Self::BatchPartial { .. }
                                | Self::Undo { .. }
                                | Self::Pomodoro { .. }
                                | Self::ResolveConflict { .. }
                        )
                    })
                {
                    return Err(crate::RuntimeError::Validation(
                        "partial batch requires at most 1000 ordinary commands".to_owned(),
                    ));
                }
                for command in commands {
                    command.validate_contract()?;
                }
            }
            Self::Batch { commands } => {
                if commands.is_empty()
                    || commands.len() > 1_000
                    || commands.iter().any(|c| {
                        matches!(
                            c,
                            Self::Batch { .. }
                                | Self::BatchPartial { .. }
                                | Self::Undo { .. }
                                | Self::Pomodoro { .. }
                                | Self::ResolveConflict { .. }
                        )
                    })
                {
                    return Err(crate::RuntimeError::Validation(
                        "batch requires 1..1000 ordinary commands".to_owned(),
                    ));
                }
                for command in commands {
                    command.validate_contract()?;
                }
            }
            Self::ReorderViews { ids }
                if ids.iter().collect::<std::collections::BTreeSet<_>>().len() != ids.len() =>
            {
                return Err(crate::RuntimeError::Validation(
                    "view ordering contains duplicates".to_owned(),
                ));
            }
            _ => {}
        }
        Ok(())
    }

    fn validate_completion_target(&self) -> crate::Result<()> {
        if let Self::SetStatus {
            occurrence_date: Some(date),
            ..
        }
        | Self::EditTask {
            occurrence_date: Some(date),
            ..
        }
        | Self::SetCompletion {
            occurrence_date: Some(date),
            ..
        }
        | Self::ToggleComplete {
            occurrence_date: Some(date),
            ..
        } = self
        {
            if date.len() == 10 {
                tasknotes_vault::temporal::parse_day(date)?;
            } else {
                tasknotes_vault::temporal::parse_instant(date)?;
            }
        }
        Ok(())
    }
}

/// Content-free warning retained with the original file plan.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticCode {
    /// The selected template file was absent.
    TemplateMissing,
    /// The selected template could not be parsed or expanded.
    TemplateParseFailed,
    /// A platform path limit required a shorter filename.
    FilenameShortened,
}

/// One closed, content-free diagnostic. Paths and template text never cross here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Diagnostic {
    /// Stable warning code translated by the native presentation layer.
    pub code: DiagnosticCode,
}

pub(crate) fn deserialize_diagnostics<'de, D: serde::Deserializer<'de>>(
    decoder: D,
) -> std::result::Result<Vec<Diagnostic>, D::Error> {
    let diagnostics = Vec::<Diagnostic>::deserialize(decoder)?;
    if diagnostics.len() > 3
        || diagnostics
            .iter()
            .map(|value| &value.code)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != diagnostics.len()
    {
        return Err(serde::de::Error::custom(
            "diagnostics must contain at most three unique codes",
        ));
    }
    Ok(diagnostics)
}

#[derive(Deserialize)]
#[serde(transparent)]
struct DiagnosticList(#[serde(deserialize_with = "deserialize_diagnostics")] Vec<Diagnostic>);

pub(crate) fn parse_diagnostics(json: &str) -> Result<Vec<Diagnostic>> {
    serde_json::from_str::<DiagnosticList>(json)
        .map(|value| value.0)
        .map_err(|_| crate::RuntimeError::Storage("journal diagnostics are corrupt".into()))
}

/// Durably committed mutation receipt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    /// Caller-assigned idempotency identity.
    pub mutation_id: String,
    /// Whether durable file and index commit completed.
    pub applied: bool,
    /// Files/index committed; retained host backups await later cleanup.
    #[serde(default)]
    pub cleanup_pending: bool,
    /// Required original warnings. Prior schemas add absent empty arrays in migration.
    #[serde(deserialize_with = "deserialize_diagnostics")]
    pub diagnostics: Vec<Diagnostic>,
    /// Authoritative primary create/edit/update identity, including a title rename.
    /// Historical receipts and commands without one primary task expose null.
    #[serde(default)]
    pub task_path: Option<String>,
    /// Affected logical paths.
    pub paths: Vec<String>,
    /// Pending upload count after this commit.
    pub pending_count: u64,
}

/// Immutable upload payload retained until an exact acknowledgement.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpload {
    /// Durable operation identity, including a per-file suffix.
    pub mutation_id: String,
    /// Logical target path.
    pub path: String,
    /// Replacement bytes or a deletion tombstone.
    #[serde(skip_serializing)]
    pub bytes: Option<Vec<u8>>,
    /// Exact immutable payload byte count; zero also describes empty files.
    pub payload_size: u64,
    /// Absence of file content is an explicit deletion tombstone.
    pub deleted: bool,
    /// Exact new content revision; absent for deletion.
    pub content_revision: Option<String>,
    /// Remote service revision this operation was based on.
    pub expected_remote_revision: Option<String>,
    /// Original creation milliseconds; null requires metadata recovery.
    pub ctime: Option<u64>,
    /// Immutable snapshot modification milliseconds; never a new send-time clock.
    pub mtime: Option<u64>,
    /// Attribution for a locally planned rename.
    pub related_path: Option<String>,
    /// This runtime slice uploads files, not directory markers.
    pub folder: bool,
}

/// Durable overlapping versions, stored outside TaskNotes indexing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// Stable conflict identity.
    pub id: String,
    /// Affected logical path.
    pub path: String,
    /// Common ancestor, or absence.
    #[serde(default, skip_serializing)]
    pub base: Option<Vec<u8>>,
    /// Unsynchronized local edit, or deletion.
    #[serde(default, skip_serializing)]
    pub local: Option<Vec<u8>>,
    /// Remote/displaced version, or deletion.
    #[serde(default, skip_serializing)]
    pub remote: Option<Vec<u8>>,
    /// Exact remote service revision when available.
    pub remote_revision: String,
}

/// User-chosen conflict action, rechecked against the current file.
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ConflictResolution {
    /// Restore the captured local version.
    KeepLocal {},
    /// Keep the current remote/provider version.
    KeepRemote {},
    /// Save user-edited complete bytes.
    Replace {
        /// Complete edited file or deletion.
        bytes: Option<Vec<u8>>,
    },
    /// Keep remote at original path and local at an unused explicit path.
    KeepBoth {
        /// Safe unused path for the local version.
        new_path: String,
    },
}
