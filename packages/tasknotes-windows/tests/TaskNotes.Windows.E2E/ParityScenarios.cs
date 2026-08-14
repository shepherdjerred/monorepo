namespace TaskNotes.Windows.E2E
{
    /// <summary>Maps the machine-readable parity contract to serial packaged UI Automation scenarios.</summary>
    [TestClass]
    [DoNotParallelize]
    public sealed class ParityScenarios
    {
        /// <summary>Gets or sets the active MSTest context.</summary>
        public required TestContext TestContext { get; set; }

        /// <summary>Exercises first-run validation and authenticated configuration.</summary>
        [TestMethod, TestCategory("onboarding-auth")]
        public Task OnboardingAndAuthentication()
        {
            return RunAsync("onboarding-auth");
        }

        /// <summary>Verifies URL and token storage remain separated.</summary>
        [TestMethod, TestCategory("settings-credentials")]
        public Task SettingsKeepCredentialsSeparate()
        {
            return RunAsync("settings-credentials");
        }

        /// <summary>Exercises cached startup, offline queue replay, and recovery.</summary>
        [TestMethod, TestCategory("cached-offline-recovery")]
        public Task CachedOfflineReplayAndRecovery()
        {
            return RunAsync("cached-offline-recovery");
        }

        /// <summary>Exercises fixed destinations, search, filtering, sorting, and completed tasks.</summary>
        [TestMethod, TestCategory("navigation-query")]
        public Task NavigationSearchFilterSortAndCompleted()
        {
            return RunAsync("navigation-query");
        }

        /// <summary>Exercises Quick Add preview, contextual defaults, and repeated creation.</summary>
        [TestMethod, TestCategory("quick-add-create")]
        public Task QuickAddAndCreate()
        {
            return RunAsync("quick-add-create");
        }

        /// <summary>Exercises every editor field, validation, dirty protection, and deletion.</summary>
        [TestMethod, TestCategory("task-edit-delete")]
        public Task TaskEditingValidationAndDeletion()
        {
            return RunAsync("task-edit-delete");
        }

        /// <summary>Exercises plain and recurring completion plus LIFO undo.</summary>
        [TestMethod, TestCategory("completion-recurrence-undo")]
        public Task CompletionRecurrenceAndUndo()
        {
            return RunAsync("completion-recurrence-undo");
        }

        /// <summary>Exercises multi-selection bulk commands and grouped undo.</summary>
        [TestMethod, TestCategory("bulk-actions")]
        public Task BulkActionsAndGroupedUndo()
        {
            return RunAsync("bulk-actions");
        }

        /// <summary>Exercises the complete saved-view lifecycle and persistence.</summary>
        [TestMethod, TestCategory("saved-views")]
        public Task SavedViewLifecycle()
        {
            return RunAsync("saved-views");
        }

        /// <summary>Exercises every protocol route and dynamic entity destination.</summary>
        [TestMethod, TestCategory("deep-links-entities")]
        public Task DeepLinksAndEntityDestinations()
        {
            return RunAsync("deep-links-entities");
        }

        /// <summary>Exercises board loading and status moves.</summary>
        [TestMethod, TestCategory("kanban")]
        public Task KanbanMovesAndFailures()
        {
            return RunAsync("kanban");
        }

        /// <summary>Exercises live task timing and aggregate time reports.</summary>
        [TestMethod, TestCategory("time-tracking-report")]
        public Task TimeTrackingAndReport()
        {
            return RunAsync("time-tracking-report");
        }

        /// <summary>Exercises live Pomodoro state and singleton window restoration.</summary>
        [TestMethod, TestCategory("pomodoro")]
        public Task PomodoroLifecycle()
        {
            return RunAsync("pomodoro");
        }

        /// <summary>Exercises transient, authentication, and parked synchronization failures.</summary>
        [TestMethod, TestCategory("parked-errors")]
        public Task SynchronizationAndParkedErrors()
        {
            return RunAsync("parked-errors");
        }

        /// <summary>Exercises global Quick Add invocation, cancellation, rebinding, and collisions.</summary>
        [TestMethod, TestCategory("global-quick-add")]
        public Task GlobalQuickAddHotkey()
        {
            return RunAsync("global-quick-add");
        }

        /// <summary>Exercises cold launch, process restart, and shell-state persistence.</summary>
        [TestMethod, TestCategory("package-persistence")]
        public Task PackagedLaunchAndPersistence()
        {
            return RunAsync("package-persistence");
        }

        /// <summary>Exercises keyboard traversal, accessible properties, and live announcements.</summary>
        [TestMethod, TestCategory("accessibility-keyboard")]
        public Task KeyboardAndAccessibilityContract()
        {
            return RunAsync("accessibility-keyboard");
        }

        /// <summary>Exercises canonical layouts under requested scale and contrast settings.</summary>
        [TestMethod, TestCategory("visual-modes")]
        public Task ScaleThemeAndHighContrast()
        {
            return RunAsync("visual-modes");
        }

        private Task RunAsync(string scenarioId)
        {
            return ScenarioDriver.RunAsync(scenarioId, TestContext.CancellationToken);
        }
    }
}
