namespace TaskNotes.Windows.Host
{
    /// <summary>Stable identifiers shared by the packaged app and Windows UI Automation tests.</summary>
    public static class AutomationIds
    {
        /// <summary>Main navigation control.</summary>
        public const string Navigation = "TaskNotes.Navigation";

        /// <summary>Reusable task list.</summary>
        public const string TaskList = "TaskNotes.TaskList";

        /// <summary>List search field.</summary>
        public const string Search = "TaskNotes.Search";

        /// <summary>Current task-list destination heading.</summary>
        public const string DestinationTitle = "TaskNotes.Destination.Title";

        /// <summary>Quick Add input.</summary>
        public const string QuickAddInput = "TaskNotes.QuickAdd.Input";

        /// <summary>Quick Add preview.</summary>
        public const string QuickAddPreview = "TaskNotes.QuickAdd.Preview";

        /// <summary>Quick Add save command.</summary>
        public const string QuickAddSave = "TaskNotes.QuickAdd.Save";

        /// <summary>Quick Add save-and-repeat command.</summary>
        public const string QuickAddSaveAnother = "TaskNotes.QuickAdd.SaveAnother";

        /// <summary>Task editor title.</summary>
        public const string EditorTitle = "TaskNotes.Editor.Title";

        /// <summary>Task editor details.</summary>
        public const string EditorDetails = "TaskNotes.Editor.Details";

        /// <summary>Task editor status.</summary>
        public const string EditorStatus = "TaskNotes.Editor.Status";

        /// <summary>Task editor priority.</summary>
        public const string EditorPriority = "TaskNotes.Editor.Priority";

        /// <summary>Task editor scheduled date.</summary>
        public const string EditorScheduled = "TaskNotes.Editor.Scheduled";

        /// <summary>Task editor due date.</summary>
        public const string EditorDue = "TaskNotes.Editor.Due";

        /// <summary>Task editor recurrence.</summary>
        public const string EditorRecurrence = "TaskNotes.Editor.Recurrence";

        /// <summary>Task editor recurrence anchor.</summary>
        public const string EditorRecurrenceAnchor = "TaskNotes.Editor.RecurrenceAnchor";

        /// <summary>Task editor projects.</summary>
        public const string EditorProjects = "TaskNotes.Editor.Projects";

        /// <summary>Task editor contexts.</summary>
        public const string EditorContexts = "TaskNotes.Editor.Contexts";

        /// <summary>Task editor tags.</summary>
        public const string EditorTags = "TaskNotes.Editor.Tags";

        /// <summary>Task editor estimate.</summary>
        public const string EditorEstimate = "TaskNotes.Editor.Estimate";

        /// <summary>Task editor save command.</summary>
        public const string EditorSave = "TaskNotes.Editor.Save";

        /// <summary>Task editor delete command.</summary>
        public const string EditorDelete = "TaskNotes.Editor.Delete";

        /// <summary>Global synchronization status live region.</summary>
        public const string SyncStatus = "TaskNotes.SyncStatus";

        /// <summary>Settings server URL.</summary>
        public const string ServerUrl = "TaskNotes.Settings.ServerUrl";

        /// <summary>Settings token.</summary>
        public const string Token = "TaskNotes.Settings.Token";

        /// <summary>Settings save command.</summary>
        public const string SaveSettings = "TaskNotes.Settings.Save";

        /// <summary>Settings connection or validation status.</summary>
        public const string SettingsStatus = "TaskNotes.Settings.Status";

        /// <summary>Device-local saved-view metadata list.</summary>
        public const string SavedViewsList = "TaskNotes.Settings.SavedViews";

        /// <summary>Parked core mutations list.</summary>
        public const string ParkedChangesList = "TaskNotes.Settings.ParkedChanges";

        /// <summary>Global Quick Add hotkey binding field.</summary>
        public const string Hotkey = "TaskNotes.Settings.Hotkey";

        /// <summary>Apply the configured global Quick Add hotkey.</summary>
        public const string ApplyHotkey = "TaskNotes.Settings.Hotkey.Apply";

        /// <summary>Clear the configured global Quick Add hotkey.</summary>
        public const string ClearHotkey = "TaskNotes.Settings.Hotkey.Clear";

        /// <summary>Global Quick Add hotkey registration result.</summary>
        public const string HotkeyStatus = "TaskNotes.Settings.HotkeyStatus";

        /// <summary>Kanban board.</summary>
        public const string Board = "TaskNotes.Board";

        /// <summary>Pomodoro window root.</summary>
        public const string PomodoroWindow = "TaskNotes.Pomodoro";

        /// <summary>Live Pomodoro server state.</summary>
        public const string PomodoroStatus = "TaskNotes.Pomodoro.Status";

        /// <summary>Time report window root.</summary>
        public const string TimeReportWindow = "TaskNotes.TimeReport";

        /// <summary>Aggregate tracked-time total.</summary>
        public const string TimeReportTotal = "TaskNotes.TimeReport.Total";

        /// <summary>Tracked-time report rows.</summary>
        public const string TimeReportRows = "TaskNotes.TimeReport.Rows";

        /// <summary>Test-only diagnostic reset command.</summary>
        public const string ResetDiagnostic = "TaskNotes.Diagnostics.Reset";

        /// <summary>Returns the stable ID for one projected task row.</summary>
        public static string TaskRow(string taskId)
        {
            return $"TaskNotes.Task.{taskId}";
        }

        /// <summary>Returns the stable ID for one navigation route.</summary>
        public static string Route(string route)
        {
            return $"TaskNotes.Route.{route}";
        }

        /// <summary>Returns the stable ID for one Kanban status column.</summary>
        public static string BoardColumn(string status)
        {
            return $"TaskNotes.Board.{status}";
        }
    }
}
