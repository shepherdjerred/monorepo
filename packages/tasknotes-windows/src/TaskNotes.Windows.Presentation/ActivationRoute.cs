namespace TaskNotes.Windows.Presentation
{
    /// <summary>A parsed tasknotes activation that does not depend on WinUI.</summary>
    public sealed record ActivationRoute(string Action, string? Value, string? Query);

    /// <summary>Parses every supported tasknotes URI into a portable activation.</summary>
    public static class ActivationRouteParser
    {
        /// <summary>Parses a tasknotes URI and rejects unknown routes.</summary>
        public static ActivationRoute Parse(Uri uri)
        {
            ArgumentNullException.ThrowIfNull(uri);
            if (!string.Equals(uri.Scheme, "tasknotes", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException(
                    "TaskNotes activation requires the tasknotes URI scheme.",
                    nameof(uri)
                );
            }

            string action = uri.Host.ToUpperInvariant();
            string? value = uri
                .AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries)
                .FirstOrDefault();
            string? query = QueryParameter(uri, action == "QUICK-ADD" ? "text" : "q");
            return action switch
            {
                "INBOX" => new ActivationRoute("inbox", value, query),
                "TODAY" => new ActivationRoute("today", value, query),
                "UPCOMING" => new ActivationRoute("upcoming", value, query),
                "BROWSE" => new ActivationRoute("browse", value, query),
                "COMPLETED" => new ActivationRoute("completed", value, query),
                "KANBAN" => new ActivationRoute("kanban", value, query),
                "SETTINGS" => new ActivationRoute("settings", value, query),
                "SEARCH" => new ActivationRoute("search", value, query),
                "QUICK-ADD" => new ActivationRoute("quick-add", value, query),
                "POMODORO" => new ActivationRoute("pomodoro", value, query),
                "TIME-REPORT" => new ActivationRoute("time-report", value, query),
                // The singular hosts are the cross-client vocabulary the macOS and
                // iOS clients emit (TaskNotesKit/TaskNotesURL.swift: task, project,
                // context, tag, view), so links they hand off must resolve here for
                // activation.deep-links parity to hold. The plural spellings are
                // this client's own and stay accepted for the links its end-to-end
                // scenarios already produce.
                "TASK" or "TASKS" when value is not null => new ActivationRoute(
                    "tasks",
                    Uri.UnescapeDataString(value),
                    query
                ),
                "PROJECT" or "PROJECTS" when value is not null => new ActivationRoute(
                    "projects",
                    Uri.UnescapeDataString(value),
                    query
                ),
                "CONTEXT" or "CONTEXTS" when value is not null => new ActivationRoute(
                    "contexts",
                    Uri.UnescapeDataString(value),
                    query
                ),
                "TAG" or "TAGS" when value is not null => new ActivationRoute(
                    "tags",
                    Uri.UnescapeDataString(value),
                    query
                ),
                "VIEW" or "SAVED-VIEWS" when value is not null => new ActivationRoute(
                    "saved-views",
                    Uri.UnescapeDataString(value),
                    query
                ),
                "DIAGNOSTICS" => new ActivationRoute("diagnostics", value, query),
                _ => throw new ArgumentException(
                    $"Unsupported TaskNotes route '{action}'.",
                    nameof(uri)
                ),
            };
        }

        private static string? QueryParameter(Uri uri, string name)
        {
            foreach (
                string component in uri
                    .Query.TrimStart('?')
                    .Split('&', StringSplitOptions.RemoveEmptyEntries)
            )
            {
                string[] pair = component.Split('=', 2);
                if (
                    Uri.UnescapeDataString(pair[0]).Equals(name, StringComparison.OrdinalIgnoreCase)
                )
                {
                    return pair.Length == 2
                        ? Uri.UnescapeDataString(pair[1].Replace('+', ' '))
                        : string.Empty;
                }
            }
            return null;
        }
    }
}
