using Core = uniffi.TaskNotesCore;
using CoreTask = uniffi.TaskNotesCore.Task;

namespace TaskNotes.Windows.Host
{
    /// <summary>
    /// Projects immutable core snapshots into fixed lists, scoped lists, saved views, and board rows.
    /// Domain filtering, recurrence, ordering, and display semantics continue to come from Rust.
    /// </summary>
    internal sealed class TaskProjectionService(Func<string, SavedViewDefinition> requireSavedView)
    {
        private static readonly string ExcludedOccurrence = new('\0', 1);
        private readonly Func<string, SavedViewDefinition> _requireSavedView =
            requireSavedView ?? throw new ArgumentNullException(nameof(requireSavedView));

        internal TaskProjection ProjectTasks(
            IReadOnlyList<CoreTask> snapshot,
            TaskListQuery query,
            string today,
            HashSet<string> pending
        )
        {
            CoreTask[] corpus = [.. snapshot.Where(task => !task.Archived)];
            Dictionary<string, string?> occurrences = new(StringComparer.Ordinal);
            List<CoreTask> admitted = [];
            foreach (CoreTask task in Scope(corpus, query))
            {
                string? occurrence = Admission(task, query.Kind, today);
                if (occurrence == ExcludedOccurrence)
                {
                    continue;
                }
                admitted.Add(task);
                occurrences[task.Id] = occurrence;
            }

            Core.FilterChain queryFilter = BuildFilterChain(query);
            CoreTask[] filtered = Core.TaskNotesCoreMethods.TaskFilterChainIsActive(queryFilter)
                ? Core.TaskNotesCoreMethods.TaskFilterChainApply([.. admitted], queryFilter)
                : [.. admitted];
            Core.SortConfig? sort = BuildSort(query);
            CoreTask[] ordered = sort is null
                ? filtered
                : Core.TaskNotesCoreMethods.TaskSortApply(filtered, sort, today);
            return new TaskProjection([
                .. ordered.Select(task =>
                    ProjectTask(
                        task,
                        pending.Contains(task.Id),
                        occurrences.GetValueOrDefault(task.Id),
                        query.Group,
                        today
                    )
                ),
            ]);
        }

        internal static QuickAddContext QuickAddDefaults(TaskListQuery context, string today)
        {
            return context.Kind switch
            {
                TaskListKind.Today => new QuickAddContext(today, [], [], []),
                TaskListKind.Project => new QuickAddContext(null, [RequireScope(context)], [], []),
                TaskListKind.Context => new QuickAddContext(null, [], [RequireScope(context)], []),
                TaskListKind.Tag => new QuickAddContext(null, [], [], [RequireScope(context)]),
                TaskListKind.Inbox
                or TaskListKind.Upcoming
                or TaskListKind.Browse
                or TaskListKind.Completed
                or TaskListKind.SavedView
                or TaskListKind.Board => new QuickAddContext(null, [], [], []),
                _ => throw new InvalidOperationException($"Unknown task list kind {context.Kind}."),
            };
        }

        internal static Core.FilterChain BuildFilterChain(TaskListQuery query)
        {
            Core.FilterConfig filter = Filter(
                projects: query.Projects,
                contexts: query.Contexts,
                tags: query.Tags,
                statuses: query.Statuses.Select(Core.TaskNotesCoreMethods.TaskStatusParse),
                priorities: query.Priorities.Select(Core.TaskNotesCoreMethods.PriorityParse),
                hasNoDueDate: query.HasNoDueDate,
                search: query.Search
            );
            return new Core.FilterChain([filter]);
        }

        internal static Core.SortConfig? BuildSort(TaskListQuery query)
        {
            Core.SortField? field = query.Sort switch
            {
                TaskSortChoice.AsSynchronized => null,
                TaskSortChoice.EffectiveDate => Core.SortField.EffectiveDate,
                TaskSortChoice.DueDate => Core.SortField.DueDate,
                TaskSortChoice.Priority => Core.SortField.Priority,
                TaskSortChoice.Title => Core.SortField.Title,
                _ => throw new InvalidOperationException($"Unknown task sort {query.Sort}."),
            };
            return field is Core.SortField value
                ? new Core.SortConfig(
                    value,
                    query.Descending ? Core.SortDirection.Desc : Core.SortDirection.Asc
                )
                : null;
        }

        internal static IReadOnlyList<SavedViewDefinition> DefaultSavedViews()
        {
            Core.SortConfig dueAscending = new(Core.SortField.DueDate, Core.SortDirection.Asc);
            return
            [
                new SavedViewDefinition
                {
                    Id = "job-search",
                    Name = "Job Search",
                    Symbol = "Briefcase",
                    Tint = "#6366f1",
                    IsFavorite = true,
                    Order = 0,
                    FilterJson = Core.TaskNotesCoreMethods.FilterChainToJson(
                        new Core.FilterChain([Filter(projects: ["[[2026 Job Search]]"])])
                    ),
                    SortJson = Core.TaskNotesCoreMethods.SortConfigToJson(dueAscending),
                },
                new SavedViewDefinition
                {
                    Id = "school",
                    Name = "School",
                    Symbol = "Library",
                    Tint = "#22c55e",
                    IsFavorite = true,
                    Order = 1,
                    FilterJson = Core.TaskNotesCoreMethods.FilterChainToJson(
                        new Core.FilterChain([Filter(contexts: ["school"])])
                    ),
                    SortJson = Core.TaskNotesCoreMethods.SortConfigToJson(dueAscending),
                },
            ];
        }

        internal static IReadOnlyList<string> Taxonomy(IEnumerable<string> values, bool project)
        {
            return
            [
                .. values
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(
                        value =>
                            project ? Core.TaskNotesCoreMethods.ProjectDisplayName(value) : value,
                        StringComparer.OrdinalIgnoreCase
                    ),
            ];
        }

        private CoreTask[] Scope(CoreTask[] tasks, TaskListQuery query)
        {
            if (query.Kind == TaskListKind.SavedView)
            {
                SavedViewDefinition view = _requireSavedView(query.Scope ?? string.Empty);
                Core.FilterChain chain = Core.TaskNotesCoreMethods.FilterChainFromJson(
                    view.FilterJson
                );
                return Core.TaskNotesCoreMethods.TaskFilterChainIsActive(chain)
                    ? Core.TaskNotesCoreMethods.TaskFilterChainApply(tasks, chain)
                    : tasks;
            }

            Core.FilterConfig? scope = query.Kind switch
            {
                TaskListKind.Project => Filter(projects: [RequireScope(query)]),
                TaskListKind.Context => Filter(contexts: [RequireScope(query)]),
                TaskListKind.Tag => Filter(tags: [RequireScope(query)]),
                TaskListKind.Inbox
                or TaskListKind.Today
                or TaskListKind.Upcoming
                or TaskListKind.Browse
                or TaskListKind.Completed
                or TaskListKind.SavedView
                or TaskListKind.Board => null,
                _ => throw new InvalidOperationException($"Unknown task list kind {query.Kind}."),
            };
            return scope is null ? tasks : Core.TaskNotesCoreMethods.TaskFilterApply(tasks, scope);
        }

        private static string? Admission(CoreTask task, TaskListKind kind, string today)
        {
            return kind switch
            {
                TaskListKind.Today => TodayAdmission(task, today),
                TaskListKind.Inbox => InboxAdmission(task),
                TaskListKind.Upcoming => UpcomingAdmission(task, today),
                TaskListKind.Completed => Core.TaskNotesCoreMethods.TaskStatusIsActive(task.Status)
                    ? ExcludedOccurrence
                    : null,
                TaskListKind.Board
                or TaskListKind.Browse
                or TaskListKind.Project
                or TaskListKind.Context
                or TaskListKind.Tag
                or TaskListKind.SavedView => null,
                _ => throw new InvalidOperationException($"Unknown task list kind {kind}."),
            };
        }

        private static string? TodayAdmission(CoreTask task, string today)
        {
            if (!Core.TaskNotesCoreMethods.TaskStatusIsActive(task.Status))
            {
                return ExcludedOccurrence;
            }
            if (!string.IsNullOrWhiteSpace(task.Recurrence))
            {
                return Core.TaskNotesCoreMethods.RecurrenceOccursOn(
                    task.Recurrence,
                    task.Scheduled,
                    task.DateCreated,
                    today
                )
                    ? Core.TaskNotesCoreMethods.RecurrenceCompletionTargetDate(
                        task.Scheduled,
                        task.Due,
                        task.RecurrenceAnchor,
                        today
                    )
                    : ExcludedOccurrence;
            }
            string? date = CivilDate(task.Due) ?? CivilDate(task.Scheduled);
            return
                date is not null
                && (
                    Core.TaskNotesCoreMethods.DateIsToday(date, today)
                    || Core.TaskNotesCoreMethods.DateIsOverdue(date, today)
                )
                ? null
                : ExcludedOccurrence;
        }

        private static string? InboxAdmission(CoreTask task)
        {
            bool admitted =
                Core.TaskNotesCoreMethods.TaskStatusIsActive(task.Status)
                && task.Projects.Length == 0
                && task.Contexts.Length == 0
                && string.IsNullOrWhiteSpace(task.Recurrence)
                && CivilDate(task.Due) is null
                && CivilDate(task.Scheduled) is null;
            return admitted ? null : ExcludedOccurrence;
        }

        private static string? UpcomingAdmission(CoreTask task, string today)
        {
            if (!Core.TaskNotesCoreMethods.TaskStatusIsActive(task.Status))
            {
                return ExcludedOccurrence;
            }
            if (!string.IsNullOrWhiteSpace(task.Recurrence))
            {
                string? occurrence = Core.TaskNotesCoreMethods.RecurrenceNextUncompletedOccurrence(
                    task.Recurrence,
                    task.Scheduled,
                    task.DateCreated,
                    today,
                    task.RecurrenceAnchor ?? Core.RecurrenceAnchor.Scheduled,
                    task.CompleteInstances,
                    task.SkippedInstances
                );
                return
                    occurrence is not null
                    && Core.TaskNotesCoreMethods.DateIsUpcoming(
                        occurrence,
                        today,
                        new Core.UpcomingHorizon.Unbounded()
                    )
                    ? occurrence
                    : ExcludedOccurrence;
            }
            string? date = CivilDate(task.Due) ?? CivilDate(task.Scheduled);
            return
                date is not null
                && Core.TaskNotesCoreMethods.DateIsUpcoming(
                    date,
                    today,
                    new Core.UpcomingHorizon.Unbounded()
                )
                ? null
                : ExcludedOccurrence;
        }

        private static TaskItem ProjectTask(
            CoreTask task,
            bool pending,
            string? occurrence,
            TaskGroupChoice group,
            string today
        )
        {
            bool recurring = !string.IsNullOrWhiteSpace(task.Recurrence);
            bool completed =
                recurring && occurrence is not null
                    ? task.CompleteInstances.Contains(occurrence, StringComparer.Ordinal)
                    : !Core.TaskNotesCoreMethods.TaskStatusIsActive(task.Status);
            return new TaskItem(
                task.Id,
                task.Title,
                task.Details,
                Core.TaskNotesCoreMethods.TaskStatusWireValue(task.Status),
                Core.TaskNotesCoreMethods.TaskStatusLabel(task.Status),
                Core.TaskNotesCoreMethods.PriorityWireValue(task.Priority),
                Core.TaskNotesCoreMethods.PriorityLabel(task.Priority),
                task.Due,
                task.Scheduled,
                task.Recurrence,
                task.RecurrenceAnchor is Core.RecurrenceAnchor anchor
                    ? Core.TaskNotesCoreMethods.RecurrenceAnchorWireValue(anchor)
                    : null,
                task.Projects,
                task.Contexts,
                task.Tags,
                task.TimeEstimate,
                task.TotalTrackedTime,
                task.IsBlocked,
                task.IsBlocking,
                completed,
                recurring,
                pending,
                occurrence,
                GroupLabel(task, occurrence, group, today),
                task.TimeEntries.Any(entry => entry.EndTime is null)
            );
        }

        private static Core.FilterConfig Filter(
            IEnumerable<string>? projects = null,
            IEnumerable<string>? contexts = null,
            IEnumerable<string>? tags = null,
            IEnumerable<Core.TaskStatus>? statuses = null,
            IEnumerable<Core.Priority>? priorities = null,
            bool hasNoDueDate = false,
            string search = ""
        )
        {
            return new Core.FilterConfig(
                projects?.ToArray() ?? [],
                contexts?.ToArray() ?? [],
                tags?.ToArray() ?? [],
                statuses?.ToArray() ?? [],
                priorities?.ToArray() ?? [],
                hasNoDueDate,
                search
            );
        }

        private static string GroupLabel(
            CoreTask task,
            string? occurrence,
            TaskGroupChoice group,
            string today
        )
        {
            return group switch
            {
                TaskGroupChoice.None => string.Empty,
                TaskGroupChoice.Date => DateGroupLabel(
                    occurrence ?? CivilDate(task.Due) ?? CivilDate(task.Scheduled),
                    today
                ),
                TaskGroupChoice.Status => Core.TaskNotesCoreMethods.TaskStatusLabel(task.Status),
                TaskGroupChoice.Priority => Core.TaskNotesCoreMethods.PriorityLabel(task.Priority),
                TaskGroupChoice.Project => task.Projects.FirstOrDefault() is string project
                    ? Core.TaskNotesCoreMethods.ProjectDisplayName(project)
                    : "No Project",
                _ => throw new InvalidOperationException($"Unknown task group {group}."),
            };
        }

        private static string DateGroupLabel(string? date, string today)
        {
            if (date is null)
            {
                return "No Date";
            }
            Core.DateGroup group = Core.TaskNotesCoreMethods.DateGroup(date, today);
            return Core.TaskNotesCoreMethods.DateGroupHeading(group) ?? date;
        }

        private static string RequireScope(TaskListQuery query)
        {
            return string.IsNullOrWhiteSpace(query.Scope)
                ? throw new Core.CoreException.Validation($"{query.Kind} requires a scope.")
                : query.Scope;
        }

        private static string? CivilDate(string? raw)
        {
            if (raw is null)
            {
                return null;
            }
            int offset = checked(
                (int)TimeZoneInfo.Local.GetUtcOffset(DateTimeOffset.Now).TotalSeconds
            );
            return Core.TaskNotesCoreMethods.DateParseLocal(raw, offset);
        }
    }

    internal sealed record TaskProjection(IReadOnlyList<TaskItem> Tasks);

    internal sealed record QuickAddContext(
        string? Due,
        IReadOnlyList<string> Projects,
        IReadOnlyList<string> Contexts,
        IReadOnlyList<string> Tags
    );
}
