using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Presentation
{
    /// <summary>The presentation destination derived from navigation or activation.</summary>
    public sealed record NavigationRoute
    {
        private NavigationRoute(
            string route,
            string title,
            string subtitle,
            TaskListQuery? query,
            PresentationDestination destination
        )
        {
            Route = route;
            Title = title;
            Subtitle = subtitle;
            Query = query;
            Destination = destination;
        }

        /// <summary>Gets the stable shell route.</summary>
        public string Route { get; }

        /// <summary>Gets the destination title.</summary>
        public string Title { get; }

        /// <summary>Gets the explanatory subtitle.</summary>
        public string Subtitle { get; }

        /// <summary>Gets the core-backed task query, when this is a task destination.</summary>
        public TaskListQuery? Query { get; init; }

        /// <summary>Gets the shell presentation destination.</summary>
        public PresentationDestination Destination { get; }

        /// <summary>Parses a stable shell route.</summary>
        public static NavigationRoute Parse(string route)
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(route);
            return route switch
            {
                "settings" => new(
                    route,
                    "Settings",
                    "Server, synchronization, and application preferences",
                    null,
                    PresentationDestination.Settings
                ),
                "board" => new(
                    route,
                    "Board",
                    "Move tasks through status columns",
                    new TaskListQuery(TaskListKind.Board),
                    PresentationDestination.Board
                ),
                "inbox" => Tasks(
                    route,
                    "Inbox",
                    "Active tasks without a project or date",
                    new TaskListQuery(TaskListKind.Inbox)
                ),
                "today" => Tasks(
                    route,
                    "Today",
                    "Due, planned, overdue, and recurring today",
                    TaskListQuery.Today
                ),
                "upcoming" => Tasks(
                    route,
                    "Upcoming",
                    "Future tasks and recurring occurrences",
                    new TaskListQuery(TaskListKind.Upcoming)
                ),
                "browse" => Tasks(
                    route,
                    "Browse",
                    "Search and organize the complete active task corpus",
                    new TaskListQuery(TaskListKind.Browse)
                ),
                "completed" => Tasks(
                    route,
                    "Completed",
                    "Search completed and cancelled tasks",
                    new TaskListQuery(TaskListKind.Completed)
                ),
                _ when route.StartsWith("project:", StringComparison.Ordinal) => Scoped(
                    route,
                    TaskListKind.Project,
                    8
                ),
                _ when route.StartsWith("context:", StringComparison.Ordinal) => Scoped(
                    route,
                    TaskListKind.Context,
                    8
                ),
                _ when route.StartsWith("tag:", StringComparison.Ordinal) => Scoped(
                    route,
                    TaskListKind.Tag,
                    4
                ),
                _ when route.StartsWith("saved:", StringComparison.Ordinal) => Scoped(
                    route,
                    TaskListKind.SavedView,
                    6
                ),
                _ => throw new ArgumentException(
                    $"Unsupported TaskNotes route '{route}'.",
                    nameof(route)
                ),
            };
        }

        private static NavigationRoute Scoped(string route, TaskListKind kind, int prefixLength)
        {
            string scope = route[prefixLength..];
            if (scope.Length == 0)
            {
                throw new ArgumentException(
                    $"Scoped TaskNotes route '{route}' has no value.",
                    nameof(route)
                );
            }
            return Tasks(
                route,
                scope,
                "Filtered with the shared TaskNotes core",
                new TaskListQuery(kind, scope)
            );
        }

        private static NavigationRoute Tasks(
            string route,
            string title,
            string subtitle,
            TaskListQuery query
        )
        {
            return new NavigationRoute(
                route,
                title,
                subtitle,
                query,
                PresentationDestination.Tasks
            );
        }
    }

    /// <summary>The three mutually exclusive shell workspaces.</summary>
    public enum PresentationDestination
    {
        /// <summary>Reusable task-list workspace.</summary>
        Tasks,

        /// <summary>Status board.</summary>
        Board,

        /// <summary>Application settings.</summary>
        Settings,
    }
}
