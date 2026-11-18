using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using TaskNotes.Protocol;
using ProtocolTask = TaskNotes.Protocol.Task;

namespace TaskNotes.Windows.Host;

/// <summary>Persisted parked command envelope retaining the original <see cref="QueuedCommand"/> for retry.</summary>
public sealed record ParkedCommandRecord(
    string Id,
    string ErrorName,
    string Message,
    ushort? Status,
    DateTimeOffset FailedAt,
    QueuedCommand Command
)
{
    /// <summary>Projects the UI-facing <see cref="ParkedChange"/> summary.</summary>
    public ParkedChange ToParkedChange() => new(Id, ErrorName, Message, Status, FailedAt);
}

/// <summary>Complete point-in-time reading of the local SQLite sync cache.</summary>
public sealed record FacetCacheSnapshot(
    string? SyncToken,
    string? ServerUrl,
    DateTimeOffset? LastSyncTime,
    IReadOnlyList<ProtocolTask> Tasks,
    IReadOnlyList<Project> Projects,
    IReadOnlyList<Section> Sections,
    IReadOnlyList<Label> Labels,
    IReadOnlyList<Reminder> Reminders,
    IReadOnlyList<Filter> Filters,
    IReadOnlyList<QueuedCommand> Outbox,
    IReadOnlyList<ParkedCommandRecord> ParkedMutations
);

/// <summary>Mutable dictionary set of protocol entities used during transactional cache updates.</summary>
public sealed class MutableEntitySet
{
    /// <summary>Active tasks keyed by ID.</summary>
    public Dictionary<string, ProtocolTask> Tasks { get; } = new(StringComparer.Ordinal);

    /// <summary>Active projects keyed by ID.</summary>
    public Dictionary<string, Project> Projects { get; } = new(StringComparer.Ordinal);

    /// <summary>Active sections keyed by ID.</summary>
    public Dictionary<string, Section> Sections { get; } = new(StringComparer.Ordinal);

    /// <summary>Active labels keyed by ID.</summary>
    public Dictionary<string, Label> Labels { get; } = new(StringComparer.Ordinal);

    /// <summary>Active reminders keyed by ID.</summary>
    public Dictionary<string, Reminder> Reminders { get; } = new(StringComparer.Ordinal);

    /// <summary>Active filters keyed by ID.</summary>
    public Dictionary<string, Filter> Filters { get; } = new(StringComparer.Ordinal);
}

/// <summary>Transactional <c>Microsoft.Data.Sqlite</c> persistence for <c>/api/v1/sync</c> entities and outbox commands.</summary>
public sealed class FacetSqliteCache : IDisposable
{
    private const string SchemaSql = """
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY NOT NULL,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY NOT NULL,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sections (
            id TEXT PRIMARY KEY NOT NULL,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS labels (
            id TEXT PRIMARY KEY NOT NULL,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY NOT NULL,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS filters (
            id TEXT PRIMARY KEY NOT NULL,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS outbox (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT NOT NULL UNIQUE,
            temp_id TEXT,
            command_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS parked_mutations (
            id TEXT PRIMARY KEY NOT NULL,
            error_name TEXT NOT NULL,
            message TEXT NOT NULL,
            status INTEGER,
            failed_at TEXT NOT NULL,
            command_json TEXT NOT NULL
        );
        """;

    private readonly string _connectionString;
    private readonly SqliteConnection? _keepAlive;
    private bool _disposed;

    private FacetSqliteCache(string connectionString, SqliteConnection? keepAlive)
    {
        _connectionString = connectionString;
        _keepAlive = keepAlive;
        InitializeSchema();
    }

    /// <summary>Opens <c>facet-sync.sqlite3</c> inside the specified directory.</summary>
    public static FacetSqliteCache OpenDirectory(string directory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        Directory.CreateDirectory(directory);
        return OpenFile(Path.Combine(directory, "facet-sync.sqlite3"));
    }

    /// <summary>Opens a file-backed SQLite sync cache at an explicit file path.</summary>
    public static FacetSqliteCache OpenFile(string filePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(filePath);
        string? parent = Path.GetDirectoryName(Path.GetFullPath(filePath));
        if (!string.IsNullOrEmpty(parent))
            Directory.CreateDirectory(parent);
        SqliteConnectionStringBuilder builder = new()
        {
            DataSource = filePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        };
        return new FacetSqliteCache(builder.ToString(), keepAlive: null);
    }

    /// <summary>Opens a shared in-memory SQLite sync cache suitable for isolated unit tests.</summary>
    public static FacetSqliteCache OpenSharedMemory(string? databaseName = null)
    {
        string name = string.IsNullOrWhiteSpace(databaseName)
            ? $"facet-mem-{Guid.NewGuid():N}"
            : databaseName;
        SqliteConnectionStringBuilder builder = new()
        {
            DataSource = name,
            Mode = SqliteOpenMode.Memory,
            Cache = SqliteCacheMode.Shared,
            Pooling = false,
        };
        string connectionString = builder.ToString();
        SqliteConnection keepAlive = new(connectionString);
        keepAlive.Open();
        return new FacetSqliteCache(connectionString, keepAlive);
    }

    /// <summary>Reads the complete cached entity state, sync token, outbox, and parked mutations.</summary>
    public FacetCacheSnapshot ReadSnapshot()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        using SqliteConnection connection = OpenConnection();
        using SqliteTransaction tx = connection.BeginTransaction();
        FacetCacheSnapshot snapshot = ReadSnapshotInternal(connection, tx);
        tx.Commit();
        return snapshot;
    }

    /// <summary>Atomically applies one or more optimistic commands to local entities and appends them to the outbox.</summary>
    public FacetCacheSnapshot EnqueueAndApply(
        IReadOnlyList<QueuedCommand> commands,
        DateTimeOffset now
    )
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentNullException.ThrowIfNull(commands);
        using SqliteConnection connection = OpenConnection();
        using SqliteTransaction tx = connection.BeginTransaction();

        MutableEntitySet entities = LoadMutableEntities(connection, tx);
        foreach (QueuedCommand command in commands)
        {
            ApplyCommandToEntities(entities, command, now);
            InsertOutboxCommand(connection, tx, command);
        }
        ReplaceAllEntities(connection, tx, entities);
        FacetCacheSnapshot result = ReadSnapshotInternal(connection, tx);
        tx.Commit();
        return result;
    }

    /// <summary>Atomically reconciles a <see cref="SyncResponse"/> against local entities, temp IDs, outbox, and parked errors.</summary>
    public FacetCacheSnapshot ApplySyncResponse(
        SyncResponse response,
        IReadOnlySet<string> sentCommandUuids,
        DateTimeOffset syncedAt,
        string serverUrl
    )
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentNullException.ThrowIfNull(response);
        ArgumentNullException.ThrowIfNull(sentCommandUuids);

        using SqliteConnection connection = OpenConnection();
        using SqliteTransaction tx = connection.BeginTransaction();

        MutableEntitySet entities = LoadMutableEntities(connection, tx);
        List<QueuedCommand> outbox = ReadOutbox(connection, tx);
        List<ParkedCommandRecord> parked = ReadParked(connection, tx);

        if (response.TempIdMapping.Count > 0)
        {
            RemapEntities(entities, response.TempIdMapping);
            outbox = outbox.Select(cmd => RemapQueuedCommand(cmd, response.TempIdMapping)).ToList();
            parked = parked
                .Select(item =>
                    item with
                    {
                        Command = RemapQueuedCommand(item.Command, response.TempIdMapping),
                    }
                )
                .ToList();
        }

        List<QueuedCommand> remainingOutbox = [];
        foreach (QueuedCommand queued in outbox)
        {
            if (
                sentCommandUuids.Contains(queued.Uuid)
                && response.SyncStatus.TryGetValue(queued.Uuid, out string? status)
            )
            {
                if (string.Equals(status, "ok", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (
                    queued.TempId is string rejectedTempId
                    && !response.TempIdMapping.ContainsKey(rejectedTempId)
                )
                {
                    RemoveTempEntity(entities, rejectedTempId);
                }

                string errorMessage = ExtractCommandError(status);
                parked.RemoveAll(existing => existing.Id == queued.Uuid);
                parked.Add(
                    new ParkedCommandRecord(
                        queued.Uuid,
                        "SyncCommandError",
                        errorMessage,
                        null,
                        syncedAt,
                        queued
                    )
                );
                continue;
            }

            remainingOutbox.Add(queued);
        }

        if (response.FullSync)
        {
            entities.Tasks.Clear();
            entities.Projects.Clear();
            entities.Sections.Clear();
            entities.Labels.Clear();
            entities.Reminders.Clear();
            entities.Filters.Clear();
        }

        MergeEntityList(entities.Tasks, response.Tasks, item => item.Id, item => item.IsDeleted);
        MergeEntityList(
            entities.Projects,
            response.Projects,
            item => item.Id,
            item => item.IsDeleted
        );
        MergeEntityList(
            entities.Sections,
            response.Sections,
            item => item.Id,
            item => item.IsDeleted
        );
        MergeEntityList(entities.Labels, response.Labels, item => item.Id, item => item.IsDeleted);
        MergeEntityList(
            entities.Reminders,
            response.Reminders,
            item => item.Id,
            item => item.IsDeleted
        );
        MergeEntityList(
            entities.Filters,
            response.Filters,
            item => item.Id,
            item => item.IsDeleted
        );

        if (response.FullSync && remainingOutbox.Count > 0)
        {
            foreach (QueuedCommand pending in remainingOutbox)
                ApplyCommandToEntities(entities, pending, syncedAt);
        }

        ReplaceAllEntities(connection, tx, entities);
        ReplaceOutbox(connection, tx, remainingOutbox);
        ReplaceParked(connection, tx, parked);
        SetMeta(connection, tx, "sync_token", response.SyncToken);
        SetMeta(
            connection,
            tx,
            "last_sync_time",
            syncedAt.ToString("O", CultureInfo.InvariantCulture)
        );
        SetMeta(connection, tx, "server_url", serverUrl);

        FacetCacheSnapshot result = ReadSnapshotInternal(connection, tx);
        tx.Commit();
        return result;
    }

    /// <summary>Moves a parked mutation back into the outbox with a fresh command UUID and applies it locally.</summary>
    public FacetCacheSnapshot RetryParkedMutation(
        string parkedId,
        string newCommandUuid,
        DateTimeOffset now
    )
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentException.ThrowIfNullOrWhiteSpace(parkedId);
        ArgumentException.ThrowIfNullOrWhiteSpace(newCommandUuid);

        using SqliteConnection connection = OpenConnection();
        using SqliteTransaction tx = connection.BeginTransaction();

        List<ParkedCommandRecord> parked = ReadParked(connection, tx);
        ParkedCommandRecord target =
            parked.FirstOrDefault(item => item.Id == parkedId)
            ?? throw new FacetValidationException(
                $"Parked mutation '{parkedId}' no longer exists."
            );

        parked.RemoveAll(item => item.Id == parkedId);
        QueuedCommand reissued = target.Command with { Uuid = newCommandUuid };

        MutableEntitySet entities = LoadMutableEntities(connection, tx);
        ApplyCommandToEntities(entities, reissued, now);
        InsertOutboxCommand(connection, tx, reissued);
        ReplaceAllEntities(connection, tx, entities);
        ReplaceParked(connection, tx, parked);

        FacetCacheSnapshot result = ReadSnapshotInternal(connection, tx);
        tx.Commit();
        return result;
    }

    /// <summary>Removes a parked mutation without re-submitting it.</summary>
    public FacetCacheSnapshot DiscardParkedMutation(string parkedId)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        ArgumentException.ThrowIfNullOrWhiteSpace(parkedId);

        using SqliteConnection connection = OpenConnection();
        using SqliteTransaction tx = connection.BeginTransaction();

        using (SqliteCommand delete = connection.CreateCommand())
        {
            delete.Transaction = tx;
            delete.CommandText = "DELETE FROM parked_mutations WHERE id = $id;";
            delete.Parameters.AddWithValue("$id", parkedId);
            int affected = delete.ExecuteNonQuery();
            if (affected == 0)
            {
                throw new FacetValidationException(
                    $"Parked mutation '{parkedId}' no longer exists."
                );
            }
        }

        FacetCacheSnapshot result = ReadSnapshotInternal(connection, tx);
        tx.Commit();
        return result;
    }

    /// <summary>Clears cached server state when switching to a different server origin.</summary>
    public FacetCacheSnapshot ResetForServer(string? serverUrl)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        using SqliteConnection connection = OpenConnection();
        using SqliteTransaction tx = connection.BeginTransaction();

        foreach (
            string table in new[]
            {
                "tasks",
                "projects",
                "sections",
                "labels",
                "reminders",
                "filters",
                "outbox",
                "parked_mutations",
                "sync_meta",
            }
        )
        {
            using SqliteCommand clear = connection.CreateCommand();
            clear.Transaction = tx;
            clear.CommandText = $"DELETE FROM {table};";
            clear.ExecuteNonQuery();
        }

        if (!string.IsNullOrWhiteSpace(serverUrl))
            SetMeta(connection, tx, "server_url", serverUrl.Trim());

        FacetCacheSnapshot result = ReadSnapshotInternal(connection, tx);
        tx.Commit();
        return result;
    }

    /// <summary>Applies a single <see cref="QueuedCommand"/> optimistically to an in-memory entity set.</summary>
    public static void ApplyCommandToEntities(
        MutableEntitySet entities,
        QueuedCommand queued,
        DateTimeOffset now
    )
    {
        ArgumentNullException.ThrowIfNull(entities);
        ArgumentNullException.ThrowIfNull(queued);

        string timestamp = now.ToString("O", CultureInfo.InvariantCulture);
        DateOnly today = DateOnly.FromDateTime(now.UtcDateTime);
        string createdId = queued.TempId ?? queued.Uuid;

        switch (queued.Command)
        {
            case SyncCommand.TaskAdd { Args: var args }:
            {
                string? rule = NullIfEmpty(args.RecurrenceRule);
                entities.Tasks[createdId] = new ProtocolTask(
                    Id: createdId,
                    UserId: "local",
                    ProjectId: args.ProjectId,
                    SectionId: NullIfEmpty(args.SectionId),
                    ParentId: NullIfEmpty(args.ParentId),
                    Title: args.Title,
                    Description: args.Description ?? string.Empty,
                    Priority: args.Priority ?? Priority.P4,
                    ChildOrder: args.ChildOrder ?? NextTaskOrder(entities.Tasks.Values),
                    DueDate: NullIfEmpty(args.DueDate),
                    DueDatetime: NullIfEmpty(args.DueDatetime),
                    DueTimezone: NullIfEmpty(args.DueTimezone),
                    DueString: NullIfEmpty(args.DueString),
                    IsRecurring: rule is not null,
                    RecurrenceRule: rule,
                    LabelIds: args.LabelIds?.ToArray() ?? [],
                    Completed: false,
                    CompletedAt: null,
                    IsDeleted: false,
                    CreatedAt: timestamp,
                    UpdatedAt: timestamp
                );
                break;
            }

            case SyncCommand.TaskUpdate { Args: var args }:
            {
                if (!entities.Tasks.TryGetValue(args.Id, out ProtocolTask? current))
                    break;
                string? nextRule = ResolveNullableUpdate(
                    args.RecurrenceRule,
                    current.RecurrenceRule
                );
                entities.Tasks[args.Id] = current with
                {
                    Title = args.Title ?? current.Title,
                    Description = args.Description ?? current.Description,
                    Priority = args.Priority ?? current.Priority,
                    ProjectId = args.ProjectId ?? current.ProjectId,
                    SectionId = ResolveNullableUpdate(args.SectionId, current.SectionId),
                    ParentId = ResolveNullableUpdate(args.ParentId, current.ParentId),
                    ChildOrder = args.ChildOrder ?? current.ChildOrder,
                    DueDate = ResolveNullableUpdate(args.DueDate, current.DueDate),
                    DueDatetime = ResolveNullableUpdate(args.DueDatetime, current.DueDatetime),
                    DueTimezone = ResolveNullableUpdate(args.DueTimezone, current.DueTimezone),
                    DueString = ResolveNullableUpdate(args.DueString, current.DueString),
                    RecurrenceRule = nextRule,
                    IsRecurring = args.RecurrenceRule is null
                        ? current.IsRecurring
                        : nextRule is not null,
                    LabelIds = args.LabelIds is null ? current.LabelIds : [.. args.LabelIds],
                    UpdatedAt = timestamp,
                };
                break;
            }

            case SyncCommand.TaskDelete { Args: var args }:
            {
                entities.Tasks.Remove(args.Id);
                string[] orphanedReminders = entities
                    .Reminders.Values.Where(rem => rem.TaskId == args.Id)
                    .Select(rem => rem.Id)
                    .ToArray();
                foreach (string reminderId in orphanedReminders)
                    entities.Reminders.Remove(reminderId);
                break;
            }

            case SyncCommand.TaskComplete { Args: var args }:
            {
                if (!entities.Tasks.TryGetValue(args.Id, out ProtocolTask? current))
                    break;
                if (current.IsRecurring && !string.IsNullOrWhiteSpace(current.RecurrenceRule))
                {
                    NextOccurrenceResult next = RecurrenceCodec.ComputeNextOccurrence(
                        current.RecurrenceRule,
                        current.DueDate,
                        today
                    );
                    if (!next.ShouldComplete && next.NextDate is not null)
                    {
                        entities.Tasks[args.Id] = current with
                        {
                            DueDate = next.NextDate,
                            RecurrenceRule = next.UpdatedRule,
                            Completed = false,
                            CompletedAt = null,
                            UpdatedAt = timestamp,
                        };
                        break;
                    }
                }
                entities.Tasks[args.Id] = current with
                {
                    Completed = true,
                    CompletedAt = args.CompletedAt ?? timestamp,
                    UpdatedAt = timestamp,
                };
                break;
            }

            case SyncCommand.TaskUncomplete { Args: var args }:
            {
                if (!entities.Tasks.TryGetValue(args.Id, out ProtocolTask? current))
                    break;
                entities.Tasks[args.Id] = current with
                {
                    Completed = false,
                    CompletedAt = null,
                    UpdatedAt = timestamp,
                };
                break;
            }

            case SyncCommand.TaskReorder { Args: var args }:
            {
                if (!entities.Tasks.TryGetValue(args.Id, out ProtocolTask? current))
                    break;
                entities.Tasks[args.Id] = current with
                {
                    ChildOrder = args.ChildOrder,
                    UpdatedAt = timestamp,
                };
                break;
            }

            case SyncCommand.ProjectAdd { Args: var args }:
            {
                entities.Projects[createdId] = new Project(
                    Id: createdId,
                    UserId: "local",
                    Name: args.Name,
                    Color: args.Color ?? "#808080",
                    ParentId: NullIfEmpty(args.ParentId),
                    ChildOrder: args.ChildOrder ?? entities.Projects.Count,
                    IsInbox: false,
                    IsFavorite: args.IsFavorite ?? false,
                    IsArchived: false,
                    IsDeleted: false,
                    CreatedAt: timestamp,
                    UpdatedAt: timestamp
                );
                break;
            }

            case SyncCommand.ProjectUpdate { Args: var args }:
            {
                if (!entities.Projects.TryGetValue(args.Id, out Project? current))
                    break;
                entities.Projects[args.Id] = current with
                {
                    Name = args.Name ?? current.Name,
                    Color = args.Color ?? current.Color,
                    ParentId = ResolveNullableUpdate(args.ParentId, current.ParentId),
                    ChildOrder = args.ChildOrder ?? current.ChildOrder,
                    IsFavorite = args.IsFavorite ?? current.IsFavorite,
                    IsArchived = args.IsArchived ?? current.IsArchived,
                    UpdatedAt = timestamp,
                };
                break;
            }

            case SyncCommand.ProjectDelete { Args: var args }:
                entities.Projects.Remove(args.Id);
                break;

            case SyncCommand.SectionAdd { Args: var args }:
            {
                entities.Sections[createdId] = new Section(
                    Id: createdId,
                    ProjectId: args.ProjectId,
                    UserId: "local",
                    Name: args.Name,
                    SectionOrder: args.SectionOrder ?? entities.Sections.Count,
                    IsArchived: false,
                    IsDeleted: false,
                    CreatedAt: timestamp,
                    UpdatedAt: timestamp
                );
                break;
            }

            case SyncCommand.SectionUpdate { Args: var args }:
            {
                if (!entities.Sections.TryGetValue(args.Id, out Section? current))
                    break;
                entities.Sections[args.Id] = current with
                {
                    Name = args.Name ?? current.Name,
                    SectionOrder = args.SectionOrder ?? current.SectionOrder,
                    IsArchived = args.IsArchived ?? current.IsArchived,
                    UpdatedAt = timestamp,
                };
                break;
            }

            case SyncCommand.SectionDelete { Args: var args }:
            {
                entities.Sections.Remove(args.Id);
                foreach (
                    ProtocolTask task in entities
                        .Tasks.Values.Where(t => t.SectionId == args.Id)
                        .ToArray()
                )
                {
                    entities.Tasks[task.Id] = task with { SectionId = null, UpdatedAt = timestamp };
                }
                break;
            }

            case SyncCommand.LabelAdd { Args: var args }:
            {
                entities.Labels[createdId] = new Label(
                    Id: createdId,
                    UserId: "local",
                    Name: args.Name,
                    Color: args.Color ?? "#808080",
                    ItemOrder: args.ItemOrder ?? entities.Labels.Count,
                    IsFavorite: args.IsFavorite ?? false,
                    IsDeleted: false
                );
                break;
            }

            case SyncCommand.LabelUpdate { Args: var args }:
            {
                if (!entities.Labels.TryGetValue(args.Id, out Label? current))
                    break;
                entities.Labels[args.Id] = current with
                {
                    Name = args.Name ?? current.Name,
                    Color = args.Color ?? current.Color,
                    ItemOrder = args.ItemOrder ?? current.ItemOrder,
                    IsFavorite = args.IsFavorite ?? current.IsFavorite,
                };
                break;
            }

            case SyncCommand.LabelDelete { Args: var args }:
            {
                entities.Labels.Remove(args.Id);
                foreach (
                    ProtocolTask task in entities
                        .Tasks.Values.Where(t =>
                            t.LabelIds.Contains(args.Id, StringComparer.Ordinal)
                        )
                        .ToArray()
                )
                {
                    entities.Tasks[task.Id] = task with
                    {
                        LabelIds = task.LabelIds.Where(id => id != args.Id).ToArray(),
                        UpdatedAt = timestamp,
                    };
                }
                break;
            }

            case SyncCommand.ReminderAdd { Args: var args }:
            {
                entities.Reminders[createdId] = new Reminder(
                    Id: createdId,
                    TaskId: args.TaskId,
                    ReminderType: args.ReminderType,
                    MinuteOffset: args.MinuteOffset,
                    DueDatetime: NullIfEmpty(args.DueDatetime),
                    IsNotified: false,
                    IsDeleted: false,
                    UpdatedAt: timestamp
                );
                break;
            }

            case SyncCommand.ReminderUpdate { Args: var args }:
            {
                if (!entities.Reminders.TryGetValue(args.Id, out Reminder? current))
                    break;
                entities.Reminders[args.Id] = current with
                {
                    ReminderType = args.ReminderType ?? current.ReminderType,
                    MinuteOffset = args.MinuteOffset ?? current.MinuteOffset,
                    DueDatetime = ResolveNullableUpdate(args.DueDatetime, current.DueDatetime),
                    IsNotified = args.IsNotified ?? current.IsNotified,
                    UpdatedAt = timestamp,
                };
                break;
            }

            case SyncCommand.ReminderDelete { Args: var args }:
                entities.Reminders.Remove(args.Id);
                break;

            case SyncCommand.FilterAdd { Args: var args }:
            {
                entities.Filters[createdId] = new Filter(
                    Id: createdId,
                    UserId: "local",
                    Name: args.Name,
                    Query: args.Query,
                    Color: args.Color ?? "Accent",
                    ItemOrder: args.ItemOrder ?? entities.Filters.Count,
                    IsFavorite: args.IsFavorite ?? false,
                    IsDeleted: false
                );
                break;
            }

            case SyncCommand.FilterUpdate { Args: var args }:
            {
                if (!entities.Filters.TryGetValue(args.Id, out Filter? current))
                    break;
                entities.Filters[args.Id] = current with
                {
                    Name = args.Name ?? current.Name,
                    Query = args.Query ?? current.Query,
                    Color = args.Color ?? current.Color,
                    ItemOrder = args.ItemOrder ?? current.ItemOrder,
                    IsFavorite = args.IsFavorite ?? current.IsFavorite,
                };
                break;
            }

            case SyncCommand.FilterDelete { Args: var args }:
                entities.Filters.Remove(args.Id);
                break;
        }
    }

    /// <summary>Rewrites <c>tmp-*</c> references inside a <see cref="QueuedCommand"/> using <c>temp_id_mapping</c>.</summary>
    public static QueuedCommand RemapQueuedCommand(
        QueuedCommand queued,
        IReadOnlyDictionary<string, string> mapping
    )
    {
        ArgumentNullException.ThrowIfNull(queued);
        ArgumentNullException.ThrowIfNull(mapping);
        if (mapping.Count == 0)
            return queued;

        string? MapNullable(string? value) =>
            value is not null && mapping.TryGetValue(value, out string? mapped) ? mapped : value;
        string MapRequired(string value) =>
            mapping.TryGetValue(value, out string? mapped) ? mapped : value;
        IReadOnlyList<string>? MapList(IReadOnlyList<string>? list) =>
            list is null ? null : list.Select(MapRequired).ToArray();

        SyncCommand remapped = queued.Command switch
        {
            SyncCommand.TaskAdd { Args: var a } => new SyncCommand.TaskAdd(
                a with
                {
                    ProjectId = MapRequired(a.ProjectId),
                    SectionId = MapNullable(a.SectionId),
                    ParentId = MapNullable(a.ParentId),
                    LabelIds = MapList(a.LabelIds),
                }
            ),
            SyncCommand.TaskUpdate { Args: var a } => new SyncCommand.TaskUpdate(
                a with
                {
                    Id = MapRequired(a.Id),
                    ProjectId = MapNullable(a.ProjectId),
                    SectionId = MapNullable(a.SectionId),
                    ParentId = MapNullable(a.ParentId),
                    LabelIds = MapList(a.LabelIds),
                }
            ),
            SyncCommand.TaskDelete { Args: var a } => new SyncCommand.TaskDelete(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.TaskComplete { Args: var a } => new SyncCommand.TaskComplete(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.TaskUncomplete { Args: var a } => new SyncCommand.TaskUncomplete(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.TaskReorder { Args: var a } => new SyncCommand.TaskReorder(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.ProjectAdd { Args: var a } => new SyncCommand.ProjectAdd(
                a with
                {
                    ParentId = MapNullable(a.ParentId),
                }
            ),
            SyncCommand.ProjectUpdate { Args: var a } => new SyncCommand.ProjectUpdate(
                a with
                {
                    Id = MapRequired(a.Id),
                    ParentId = MapNullable(a.ParentId),
                }
            ),
            SyncCommand.ProjectDelete { Args: var a } => new SyncCommand.ProjectDelete(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.SectionAdd { Args: var a } => new SyncCommand.SectionAdd(
                a with
                {
                    ProjectId = MapRequired(a.ProjectId),
                }
            ),
            SyncCommand.SectionUpdate { Args: var a } => new SyncCommand.SectionUpdate(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.SectionDelete { Args: var a } => new SyncCommand.SectionDelete(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.LabelUpdate { Args: var a } => new SyncCommand.LabelUpdate(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.LabelDelete { Args: var a } => new SyncCommand.LabelDelete(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.ReminderAdd { Args: var a } => new SyncCommand.ReminderAdd(
                a with
                {
                    TaskId = MapRequired(a.TaskId),
                }
            ),
            SyncCommand.ReminderUpdate { Args: var a } => new SyncCommand.ReminderUpdate(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.ReminderDelete { Args: var a } => new SyncCommand.ReminderDelete(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.FilterUpdate { Args: var a } => new SyncCommand.FilterUpdate(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            SyncCommand.FilterDelete { Args: var a } => new SyncCommand.FilterDelete(
                a with
                {
                    Id = MapRequired(a.Id),
                }
            ),
            _ => queued.Command,
        };

        return queued with
        {
            TempId = MapNullable(queued.TempId),
            Command = remapped,
        };
    }

    /// <summary>Releases any retained shared-memory keep-alive connection.</summary>
    public void Dispose()
    {
        if (_disposed)
            return;
        _disposed = true;
        _keepAlive?.Dispose();
    }

    private void InitializeSchema()
    {
        using SqliteConnection connection = OpenConnection();
        using SqliteCommand command = connection.CreateCommand();
        command.CommandText = SchemaSql;
        command.ExecuteNonQuery();
    }

    private SqliteConnection OpenConnection()
    {
        SqliteConnection connection = new(_connectionString);
        connection.Open();
        return connection;
    }

    private static FacetCacheSnapshot ReadSnapshotInternal(
        SqliteConnection connection,
        SqliteTransaction tx
    )
    {
        Dictionary<string, string> meta = ReadMeta(connection, tx);
        meta.TryGetValue("sync_token", out string? syncToken);
        meta.TryGetValue("server_url", out string? serverUrl);
        DateTimeOffset? lastSync =
            meta.TryGetValue("last_sync_time", out string? lastSyncRaw)
            && DateTimeOffset.TryParse(
                lastSyncRaw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out DateTimeOffset parsed
            )
                ? parsed
                : null;

        return new FacetCacheSnapshot(
            SyncToken: syncToken,
            ServerUrl: serverUrl,
            LastSyncTime: lastSync,
            Tasks: ReadTable<ProtocolTask>(connection, tx, "tasks"),
            Projects: ReadTable<Project>(connection, tx, "projects"),
            Sections: ReadTable<Section>(connection, tx, "sections"),
            Labels: ReadTable<Label>(connection, tx, "labels"),
            Reminders: ReadTable<Reminder>(connection, tx, "reminders"),
            Filters: ReadTable<Filter>(connection, tx, "filters"),
            Outbox: ReadOutbox(connection, tx),
            ParkedMutations: ReadParked(connection, tx)
        );
    }

    private static MutableEntitySet LoadMutableEntities(
        SqliteConnection connection,
        SqliteTransaction tx
    )
    {
        MutableEntitySet set = new();
        foreach (ProtocolTask item in ReadTable<ProtocolTask>(connection, tx, "tasks"))
            set.Tasks[item.Id] = item;
        foreach (Project item in ReadTable<Project>(connection, tx, "projects"))
            set.Projects[item.Id] = item;
        foreach (Section item in ReadTable<Section>(connection, tx, "sections"))
            set.Sections[item.Id] = item;
        foreach (Label item in ReadTable<Label>(connection, tx, "labels"))
            set.Labels[item.Id] = item;
        foreach (Reminder item in ReadTable<Reminder>(connection, tx, "reminders"))
            set.Reminders[item.Id] = item;
        foreach (Filter item in ReadTable<Filter>(connection, tx, "filters"))
            set.Filters[item.Id] = item;
        return set;
    }

    private static List<T> ReadTable<T>(
        SqliteConnection connection,
        SqliteTransaction tx,
        string table
    )
    {
        List<T> items = [];
        using SqliteCommand cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"SELECT json FROM {table};";
        using SqliteDataReader reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            string json = reader.GetString(0);
            T item =
                JsonSerializer.Deserialize<T>(json, FacetProtocolJson.Options)
                ?? throw new InvalidDataException($"Corrupt JSON row in SQLite table '{table}'.");
            items.Add(item);
        }
        return items;
    }

    private static void ReplaceAllEntities(
        SqliteConnection connection,
        SqliteTransaction tx,
        MutableEntitySet entities
    )
    {
        ReplaceTable(connection, tx, "tasks", entities.Tasks);
        ReplaceTable(connection, tx, "projects", entities.Projects);
        ReplaceTable(connection, tx, "sections", entities.Sections);
        ReplaceTable(connection, tx, "labels", entities.Labels);
        ReplaceTable(connection, tx, "reminders", entities.Reminders);
        ReplaceTable(connection, tx, "filters", entities.Filters);
    }

    private static void ReplaceTable<T>(
        SqliteConnection connection,
        SqliteTransaction tx,
        string table,
        Dictionary<string, T> items
    )
    {
        using (SqliteCommand clear = connection.CreateCommand())
        {
            clear.Transaction = tx;
            clear.CommandText = $"DELETE FROM {table};";
            clear.ExecuteNonQuery();
        }
        foreach ((string id, T value) in items)
        {
            using SqliteCommand insert = connection.CreateCommand();
            insert.Transaction = tx;
            insert.CommandText = $"INSERT INTO {table} (id, json) VALUES ($id, $json);";
            insert.Parameters.AddWithValue("$id", id);
            insert.Parameters.AddWithValue(
                "$json",
                JsonSerializer.Serialize(value, FacetProtocolJson.Options)
            );
            insert.ExecuteNonQuery();
        }
    }

    private static List<QueuedCommand> ReadOutbox(SqliteConnection connection, SqliteTransaction tx)
    {
        List<QueuedCommand> items = [];
        using SqliteCommand cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT command_json FROM outbox ORDER BY seq ASC;";
        using SqliteDataReader reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            string json = reader.GetString(0);
            QueuedCommand item =
                JsonSerializer.Deserialize<QueuedCommand>(json, FacetProtocolJson.Options)
                ?? throw new InvalidDataException("Corrupt QueuedCommand in outbox.");
            items.Add(item);
        }
        return items;
    }

    private static void InsertOutboxCommand(
        SqliteConnection connection,
        SqliteTransaction tx,
        QueuedCommand command
    )
    {
        using SqliteCommand insert = connection.CreateCommand();
        insert.Transaction = tx;
        insert.CommandText =
            "INSERT INTO outbox (uuid, temp_id, command_json) VALUES ($uuid, $tempId, $json);";
        insert.Parameters.AddWithValue("$uuid", command.Uuid);
        insert.Parameters.AddWithValue(
            "$tempId",
            command.TempId is null ? DBNull.Value : command.TempId
        );
        insert.Parameters.AddWithValue(
            "$json",
            JsonSerializer.Serialize(command, FacetProtocolJson.Options)
        );
        insert.ExecuteNonQuery();
    }

    private static void ReplaceOutbox(
        SqliteConnection connection,
        SqliteTransaction tx,
        IReadOnlyList<QueuedCommand> outbox
    )
    {
        using (SqliteCommand clear = connection.CreateCommand())
        {
            clear.Transaction = tx;
            clear.CommandText = "DELETE FROM outbox;";
            clear.ExecuteNonQuery();
        }
        foreach (QueuedCommand item in outbox)
            InsertOutboxCommand(connection, tx, item);
    }

    private static List<ParkedCommandRecord> ReadParked(
        SqliteConnection connection,
        SqliteTransaction tx
    )
    {
        List<ParkedCommandRecord> items = [];
        using SqliteCommand cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText =
            "SELECT id, error_name, message, status, failed_at, command_json FROM parked_mutations ORDER BY failed_at ASC;";
        using SqliteDataReader reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            string id = reader.GetString(0);
            string errorName = reader.GetString(1);
            string message = reader.GetString(2);
            ushort? status = reader.IsDBNull(3) ? null : checked((ushort)reader.GetInt32(3));
            DateTimeOffset failedAt = DateTimeOffset.Parse(
                reader.GetString(4),
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind
            );
            QueuedCommand command =
                JsonSerializer.Deserialize<QueuedCommand>(
                    reader.GetString(5),
                    FacetProtocolJson.Options
                ) ?? throw new InvalidDataException("Corrupt parked QueuedCommand.");
            items.Add(new ParkedCommandRecord(id, errorName, message, status, failedAt, command));
        }
        return items;
    }

    private static void ReplaceParked(
        SqliteConnection connection,
        SqliteTransaction tx,
        IReadOnlyList<ParkedCommandRecord> parked
    )
    {
        using (SqliteCommand clear = connection.CreateCommand())
        {
            clear.Transaction = tx;
            clear.CommandText = "DELETE FROM parked_mutations;";
            clear.ExecuteNonQuery();
        }
        foreach (ParkedCommandRecord item in parked)
        {
            using SqliteCommand insert = connection.CreateCommand();
            insert.Transaction = tx;
            insert.CommandText = """
                INSERT INTO parked_mutations (id, error_name, message, status, failed_at, command_json)
                VALUES ($id, $errorName, $message, $status, $failedAt, $json);
                """;
            insert.Parameters.AddWithValue("$id", item.Id);
            insert.Parameters.AddWithValue("$errorName", item.ErrorName);
            insert.Parameters.AddWithValue("$message", item.Message);
            insert.Parameters.AddWithValue(
                "$status",
                item.Status is ushort code ? (int)code : DBNull.Value
            );
            insert.Parameters.AddWithValue(
                "$failedAt",
                item.FailedAt.ToString("O", CultureInfo.InvariantCulture)
            );
            insert.Parameters.AddWithValue(
                "$json",
                JsonSerializer.Serialize(item.Command, FacetProtocolJson.Options)
            );
            insert.ExecuteNonQuery();
        }
    }

    private static Dictionary<string, string> ReadMeta(
        SqliteConnection connection,
        SqliteTransaction tx
    )
    {
        Dictionary<string, string> meta = new(StringComparer.Ordinal);
        using SqliteCommand cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT key, value FROM sync_meta;";
        using SqliteDataReader reader = cmd.ExecuteReader();
        while (reader.Read())
            meta[reader.GetString(0)] = reader.GetString(1);
        return meta;
    }

    private static void SetMeta(
        SqliteConnection connection,
        SqliteTransaction tx,
        string key,
        string value
    )
    {
        using SqliteCommand cmd = connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO sync_meta (key, value) VALUES ($key, $value)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;
            """;
        cmd.Parameters.AddWithValue("$key", key);
        cmd.Parameters.AddWithValue("$value", value);
        cmd.ExecuteNonQuery();
    }

    private static void RemapEntities(
        MutableEntitySet entities,
        IReadOnlyDictionary<string, string> mapping
    )
    {
        string MapReq(string value) =>
            mapping.TryGetValue(value, out string? mapped) ? mapped : value;
        string? MapOpt(string? value) =>
            value is not null && mapping.TryGetValue(value, out string? mapped) ? mapped : value;

        ProtocolTask[] tasks = entities.Tasks.Values.ToArray();
        entities.Tasks.Clear();
        foreach (ProtocolTask task in tasks)
        {
            string id = MapReq(task.Id);
            entities.Tasks[id] = task with
            {
                Id = id,
                ProjectId = MapReq(task.ProjectId),
                SectionId = MapOpt(task.SectionId),
                ParentId = MapOpt(task.ParentId),
                LabelIds = task.LabelIds.Select(MapReq).Distinct(StringComparer.Ordinal).ToArray(),
            };
        }

        Project[] projects = entities.Projects.Values.ToArray();
        entities.Projects.Clear();
        foreach (Project project in projects)
        {
            string id = MapReq(project.Id);
            entities.Projects[id] = project with { Id = id, ParentId = MapOpt(project.ParentId) };
        }

        Section[] sections = entities.Sections.Values.ToArray();
        entities.Sections.Clear();
        foreach (Section section in sections)
        {
            string id = MapReq(section.Id);
            entities.Sections[id] = section with { Id = id, ProjectId = MapReq(section.ProjectId) };
        }

        Label[] labels = entities.Labels.Values.ToArray();
        entities.Labels.Clear();
        foreach (Label label in labels)
        {
            string id = MapReq(label.Id);
            entities.Labels[id] = label with { Id = id };
        }

        Reminder[] reminders = entities.Reminders.Values.ToArray();
        entities.Reminders.Clear();
        foreach (Reminder reminder in reminders)
        {
            string id = MapReq(reminder.Id);
            entities.Reminders[id] = reminder with { Id = id, TaskId = MapReq(reminder.TaskId) };
        }

        Filter[] filters = entities.Filters.Values.ToArray();
        entities.Filters.Clear();
        foreach (Filter filter in filters)
        {
            string id = MapReq(filter.Id);
            entities.Filters[id] = filter with { Id = id };
        }
    }

    private static void RemoveTempEntity(MutableEntitySet entities, string tempId)
    {
        entities.Tasks.Remove(tempId);
        entities.Projects.Remove(tempId);
        entities.Sections.Remove(tempId);
        entities.Labels.Remove(tempId);
        entities.Reminders.Remove(tempId);
        entities.Filters.Remove(tempId);
    }

    private static void MergeEntityList<T>(
        Dictionary<string, T> target,
        IReadOnlyList<T> incoming,
        Func<T, string> getId,
        Func<T, bool> isDeleted
    )
    {
        foreach (T item in incoming)
        {
            string id = getId(item);
            if (isDeleted(item))
                target.Remove(id);
            else
                target[id] = item;
        }
    }

    private static string ExtractCommandError(string status) =>
        status.StartsWith("error:", StringComparison.OrdinalIgnoreCase)
            ? status[6..].Trim()
            : status;

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;

    private static string? ResolveNullableUpdate(string? update, string? current) =>
        update is null ? current : (update.Length == 0 ? null : update);

    private static double NextTaskOrder(IEnumerable<ProtocolTask> tasks)
    {
        double max = 0;
        foreach (ProtocolTask task in tasks)
        {
            if (task.ChildOrder > max)
                max = task.ChildOrder;
        }
        return max + 1;
    }
}
