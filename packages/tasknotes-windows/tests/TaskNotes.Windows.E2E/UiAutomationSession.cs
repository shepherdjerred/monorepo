using System.Diagnostics;
using System.Text.Json;
using System.Windows.Automation;
using TaskNotes.Windows.App.Acceptance;

namespace TaskNotes.Windows.E2E
{
    internal sealed class UiAutomationSession : IAsyncDisposable
    {
        private const int DefaultTimeoutSeconds = 30;
        private readonly OwnedPackageLifetime _ownership;
        private readonly string _runId;
        private readonly StandaloneMarkdownReader _markdown;

        internal AutomationElement Window { get; private set; }

        private UiAutomationSession(
            OwnedPackageLifetime ownership,
            string runId,
            AutomationElement window,
            StandaloneMarkdownReader markdown
        )
        {
            _ownership = ownership;
            _runId = runId;
            Window = window;
            _markdown = markdown;
        }

        internal static async Task<UiAutomationSession> LaunchStandaloneAsync(
            StandaloneAcceptanceDescriptor descriptor,
            string executable,
            string descriptorPath,
            CancellationToken cancellationToken
        )
        {
            OwnedPackageLifetime ownership = new(
                descriptor.PackageFamilyName,
                executable,
                descriptorPath
            );
            StandaloneMarkdownReader? markdown = null;
            try
            {
                ownership.Activate();
                AutomationElement window = await Task.Run(
                    () => WaitForStandaloneWindow(ownership, descriptor.RunId, cancellationToken),
                    cancellationToken
                );
                markdown = await StandaloneMarkdownReader.CreateAsync(
                    descriptor,
                    cancellationToken
                );
                ownership.RequireWindow(window, descriptor.RunId);
                return new UiAutomationSession(ownership, descriptor.RunId, window, markdown);
            }
            catch
            {
                try
                {
                    if (markdown is not null)
                        await markdown.DisposeAsync();
                }
                finally
                {
                    await ownership.DisposeAsync();
                }
                throw;
            }
        }

        private static AutomationElement WaitForStandaloneWindow(
            OwnedPackageLifetime ownership,
            string runId,
            CancellationToken cancellationToken
        )
        {
            AutomationElement result = WaitForCondition(
                () =>
                    AutomationElement.RootElement.FindFirst(
                        TreeScope.Children,
                        new AndCondition(
                            new PropertyCondition(
                                AutomationElement.ProcessIdProperty,
                                ownership.ProcessId
                            ),
                            new PropertyCondition(
                                AutomationElement.NameProperty,
                                "Facet Acceptance " + runId
                            )
                        )
                    ),
                "descriptor-bound standalone workspace",
                cancellationToken
            );
            ownership.RequireWindow(result, runId);
            return result;
        }

        internal void RequireOwnedWindow()
        {
            _ownership.RequireWindow(Window, _runId);
        }

        internal async Task<JsonElement?> ReadPropertiesAsync(
            string filename,
            CancellationToken cancellation
        )
        {
            RequireOwnedWindow();
            var properties = await _markdown.ReadAsync(filename, cancellation);
            RequireOwnedWindow();
            return properties;
        }

        internal async Task WaitForPropertyAsync(
            string filename,
            string field,
            string expected,
            CancellationToken cancellation
        )
        {
            using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(
                cancellation
            );
            timeout.CancelAfter(TimeSpan.FromSeconds(DefaultTimeoutSeconds));
            while (true)
            {
                var properties = await ReadPropertiesAsync(filename, timeout.Token);
                if (
                    properties is JsonElement document
                    && document.TryGetProperty(field, out var value)
                )
                {
                    if (value.ValueKind != JsonValueKind.String)
                        throw new AssertFailedException(
                            "A fixture scalar has an unexpected core type."
                        );
                    if (value.GetString() == expected)
                    {
                        await WaitForMutationSettlementAsync(timeout.Token);
                        return;
                    }
                }
                await Task.Delay(TimeSpan.FromMilliseconds(100), timeout.Token);
            }
        }

        internal async Task WaitForMutationSettlementAsync(CancellationToken cancellation)
        {
            using CancellationTokenSource timeout = CancellationTokenSource.CreateLinkedTokenSource(
                cancellation
            );
            timeout.CancelAfter(TimeSpan.FromSeconds(DefaultTimeoutSeconds));
            while (!await _markdown.HasSettledAsync(timeout.Token))
            {
                RequireOwnedWindow();
                await Task.Delay(TimeSpan.FromMilliseconds(50), timeout.Token);
            }
            RequireOwnedWindow();
        }

        internal AutomationElement WaitForAutomationId(
            string automationId,
            CancellationToken cancellationToken
        )
        {
            return WaitForElement(
                () =>
                    FindInApplication(
                        new PropertyCondition(AutomationElement.AutomationIdProperty, automationId)
                    ),
                $"AutomationId '{automationId}'",
                cancellationToken
            );
        }

        internal AutomationElement WaitForName(string name, CancellationToken cancellationToken)
        {
            return WaitForElement(
                () =>
                    FindInApplication(new PropertyCondition(AutomationElement.NameProperty, name)),
                $"name '{name}'",
                cancellationToken
            );
        }

        internal static AutomationElement WaitForNameWithin(
            AutomationElement ancestor,
            string name,
            CancellationToken cancellationToken
        )
        {
            return WaitForElement(
                () =>
                    ancestor.FindFirst(
                        TreeScope.Descendants,
                        new PropertyCondition(AutomationElement.NameProperty, name)
                    ),
                $"name '{name}' below '{ancestor.Current.Name}'",
                cancellationToken
            );
        }

        internal void WaitForAutomationIdAbsent(
            string automationId,
            CancellationToken cancellationToken
        )
        {
            _ = WaitForElement(
                () =>
                    FindInApplication(
                        new PropertyCondition(AutomationElement.AutomationIdProperty, automationId)
                    )
                        is null
                        ? Window
                        : null,
                $"AutomationId '{automationId}' to disappear",
                cancellationToken
            );
        }

        internal int CountTopLevelWindows(string name)
        {
            return AutomationElement
                .RootElement.FindAll(
                    TreeScope.Children,
                    new AndCondition(
                        new PropertyCondition(AutomationElement.NameProperty, name),
                        new PropertyCondition(
                            AutomationElement.ControlTypeProperty,
                            ControlType.Window
                        ),
                        new PropertyCondition(
                            AutomationElement.ProcessIdProperty,
                            Window.Current.ProcessId
                        )
                    )
                )
                .Count;
        }

        internal AutomationElement WaitForFirstControl(
            ControlType controlType,
            CancellationToken cancellationToken
        )
        {
            return WaitForElement(
                () =>
                    Window.FindFirst(
                        TreeScope.Descendants,
                        new PropertyCondition(AutomationElement.ControlTypeProperty, controlType)
                    ),
                $"control type '{controlType.ProgrammaticName}'",
                cancellationToken
            );
        }

        internal async Task<string> WaitForTextAsync(
            string automationId,
            Func<string, bool> predicate,
            CancellationToken cancellationToken
        )
        {
            return await Task.Run(
                () =>
                {
                    AutomationElement element = WaitForAutomationId(
                        automationId,
                        cancellationToken
                    );
                    _ = WaitForCondition(
                        () =>
                        {
                            string text = ReadText(element);
                            return predicate(text) ? element : null;
                        },
                        $"text predicate on '{automationId}'",
                        cancellationToken
                    );
                    return ReadText(element);
                },
                cancellationToken
            );
        }

        internal string WaitForText(
            string automationId,
            Func<string, bool> predicate,
            CancellationToken cancellationToken
        )
        {
            var element = WaitForAutomationId(automationId, cancellationToken);
            _ = WaitForCondition(
                () => predicate(ReadText(element)) ? element : null,
                "owned text predicate",
                cancellationToken
            );
            return ReadText(element);
        }

        internal void Invoke(string automationId)
        {
            InvokeElement(WaitForAutomationId(automationId, CancellationToken.None));
        }

        internal void InvokeByName(string name)
        {
            AutomationElement element = WaitForElement(
                () =>
                    FindInApplication(
                        new AndCondition(
                            new PropertyCondition(AutomationElement.NameProperty, name),
                            new PropertyCondition(
                                AutomationElement.IsInvokePatternAvailableProperty,
                                true
                            )
                        )
                    ),
                $"invokable name '{name}'",
                CancellationToken.None
            );
            InvokeElement(element);
        }

        internal static void InvokeDescendantByName(AutomationElement ancestor, string name)
        {
            AutomationElement container =
                AscendToPattern(ancestor, SelectionItemPattern.Pattern) ?? ancestor;
            AutomationElement element = WaitForElement(
                () =>
                    container.FindFirst(
                        TreeScope.Descendants,
                        new AndCondition(
                            new PropertyCondition(AutomationElement.NameProperty, name),
                            new PropertyCondition(
                                AutomationElement.IsInvokePatternAvailableProperty,
                                true
                            )
                        )
                    ),
                $"descendant command '{name}'",
                CancellationToken.None
            );
            InvokeElement(element);
        }

        internal void SetValue(string automationId, string value)
        {
            SetElementValue(WaitForAutomationId(automationId, CancellationToken.None), value);
        }

        internal void SetNamedValue(string name, string value)
        {
            AutomationElement element = WaitForElement(
                () =>
                    FindInApplication(
                        new AndCondition(
                            new PropertyCondition(AutomationElement.NameProperty, name),
                            new PropertyCondition(
                                AutomationElement.IsValuePatternAvailableProperty,
                                true
                            )
                        )
                    ),
                "owned editable field '" + name + "'",
                CancellationToken.None
            );
            SetElementValue(element, value);
        }

        internal static void SetElementValue(AutomationElement element, string value)
        {
            if (
                element.TryGetCurrentPattern(ValuePattern.Pattern, out object pattern)
                && pattern is ValuePattern valuePattern
            )
            {
                valuePattern.SetValue(value);
                return;
            }
            AutomationElement? editor = element.FindFirst(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.IsValuePatternAvailableProperty, true)
            );
            if (
                editor is not null
                && editor.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)
                && pattern is ValuePattern nested
            )
            {
                nested.SetValue(value);
                return;
            }
            throw new AssertFailedException(
                $"'{element.Current.Name}' does not expose the UIA Value pattern."
            );
        }

        internal void SelectComboValue(string automationName, string value)
        {
            RequireOwnedWindow();
            AutomationElement comboBox = WaitForElement(
                () =>
                    Window.FindFirst(
                        TreeScope.Descendants,
                        new AndCondition(
                            new PropertyCondition(AutomationElement.NameProperty, automationName),
                            new PropertyCondition(
                                AutomationElement.ControlTypeProperty,
                                ControlType.ComboBox
                            )
                        )
                    ),
                $"combo box '{automationName}'",
                CancellationToken.None
            );
            SelectComboValue(comboBox, value);
        }

        internal void ChooseMenuItem(string menuName, string itemName)
        {
            RequireOwnedWindow();
            AutomationElement menu = WaitForName(menuName, CancellationToken.None);
            if (
                menu.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out object pattern)
                && pattern is ExpandCollapsePattern expand
            )
                expand.Expand();
            else
                InvokeElement(menu);
            InvokeByName(itemName);
        }

        internal void SelectComboValueByAutomationId(string automationId, string value)
        {
            AutomationElement comboBox = WaitForAutomationId(automationId, CancellationToken.None);
            SelectComboValue(comboBox, value);
        }

        internal void SelectComboValueWithin(AutomationElement ancestor, string value)
        {
            AutomationElement comboBox = WaitForElement(
                () =>
                    ancestor.FindFirst(
                        TreeScope.Descendants,
                        new PropertyCondition(
                            AutomationElement.ControlTypeProperty,
                            ControlType.ComboBox
                        )
                    ),
                $"combo box below '{ancestor.Current.Name}'",
                CancellationToken.None
            );
            SelectComboValue(comboBox, value);
        }

        private void SelectComboValue(AutomationElement comboBox, string value)
        {
            if (
                comboBox.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out object pattern)
                && pattern is ExpandCollapsePattern expand
            )
            {
                expand.Expand();
            }
            AutomationElement item = WaitForElement(
                () =>
                    AutomationElement.RootElement.FindFirst(
                        TreeScope.Descendants,
                        new AndCondition(
                            new PropertyCondition(AutomationElement.NameProperty, value),
                            new PropertyCondition(
                                AutomationElement.ControlTypeProperty,
                                ControlType.ListItem
                            ),
                            new PropertyCondition(
                                AutomationElement.ProcessIdProperty,
                                Window.Current.ProcessId
                            )
                        )
                    ),
                $"combo box value '{value}'",
                CancellationToken.None
            );
            Select(item, false);
        }

        internal static void ToggleDescendant(AutomationElement ancestor)
        {
            AutomationElement container =
                AscendToPattern(ancestor, SelectionItemPattern.Pattern) ?? ancestor;
            AutomationElement toggle = WaitForElement(
                () =>
                    container.FindFirst(
                        TreeScope.Descendants,
                        new PropertyCondition(
                            AutomationElement.IsTogglePatternAvailableProperty,
                            true
                        )
                    ),
                "toggle descendant",
                CancellationToken.None
            );
            if (
                !toggle.TryGetCurrentPattern(TogglePattern.Pattern, out object pattern)
                || pattern is not TogglePattern togglePattern
            )
            {
                throw new AssertFailedException("Task completion control lost its Toggle pattern.");
            }
            togglePattern.Toggle();
        }

        internal void SelectTaskRows(params string[] names)
        {
            bool first = true;
            foreach (string name in names)
            {
                AutomationElement named = WaitForName(name, CancellationToken.None);
                AutomationElement selectable =
                    AscendToPattern(named, SelectionItemPattern.Pattern)
                    ?? throw new AssertFailedException(
                        $"Task row '{name}' has no SelectionItem pattern."
                    );
                Select(selectable, !first);
                first = false;
            }
        }

        internal void OpenTask(string title)
        {
            RequireOwnedWindow();
            AutomationElement label = WaitForName(title, CancellationToken.None);
            AutomationElement item =
                AscendToPattern(label, InvokePattern.Pattern)
                ?? throw new AssertFailedException(
                    "The task row has no native ItemClick Invoke pattern."
                );
            InvokeElement(item);
        }

        internal void OpenTaskByPath(string path)
        {
            var row = WaitForAutomationId(
                TaskNotes.Windows.Host.AutomationIds.TaskRow(path),
                CancellationToken.None
            );
            var item =
                AscendToPattern(row, InvokePattern.Pattern)
                ?? throw new AssertFailedException(
                    "The exact task path has no ItemClick Invoke pattern."
                );
            InvokeElement(item);
        }

        internal static void ActivateProtocol(string uri)
        {
            _ = Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }

        internal void Focus()
        {
            RequireOwnedWindow();
            Window.SetFocus();
        }

        internal void SendOwnedKeys(string keys)
        {
            RequireOwnedWindow();
            _ownership.RequireForeground();
            SendKeys.SendWait(keys);
        }

        internal void RequireWindowScale(uint dpi)
        {
            _ownership.RequireWindowScale(Window, _runId, dpi);
        }

        internal async Task RestartAsync(CancellationToken cancellationToken)
        {
            RequireOwnedWindow();
            await _ownership.StopAsync(cancellationToken);
            _ownership.Activate();
            Window = await Task.Run(
                () => WaitForStandaloneWindow(_ownership, _runId, cancellationToken),
                cancellationToken
            );
        }

        internal Task CaptureScreenshotAsync(string path, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            _ownership.CaptureWindow(Window, _runId, path);
            return Task.CompletedTask;
        }

        public async ValueTask DisposeAsync()
        {
            try
            {
                await _markdown.DisposeAsync();
            }
            finally
            {
                await _ownership.DisposeAsync();
            }
        }

        private static AutomationElement WaitForElement(
            Func<AutomationElement?> find,
            string description,
            CancellationToken cancellationToken
        )
        {
            return WaitForCondition(find, description, cancellationToken);
        }

        private AutomationElement? FindInApplication(Condition condition)
        {
            RequireOwnedWindow();
            AutomationElement? dialog = Window.FindFirst(
                TreeScope.Descendants,
                new AndCondition(
                    new PropertyCondition(
                        AutomationElement.AutomationIdProperty,
                        "TaskNotes.QuickAdd.Dialog"
                    ),
                    new PropertyCondition(AutomationElement.IsOffscreenProperty, false)
                )
            );
            AutomationElement? local = (dialog ?? Window).FindFirst(
                TreeScope.Descendants,
                condition
            );
            return local
                ?? AutomationElement.RootElement.FindFirst(
                    TreeScope.Descendants,
                    new AndCondition(
                        condition,
                        new PropertyCondition(
                            AutomationElement.ProcessIdProperty,
                            Window.Current.ProcessId
                        )
                    )
                );
        }

        private static AutomationElement WaitForCondition(
            Func<AutomationElement?> find,
            string description,
            CancellationToken cancellationToken
        )
        {
            using AutoResetEvent changed = new(false);
            void StructureHandler(object _, StructureChangedEventArgs __)
            {
                _ = changed.Set();
            }

            void PropertyHandler(object _, AutomationPropertyChangedEventArgs __)
            {
                _ = changed.Set();
            }

            StructureChangedEventHandler structureHandler = StructureHandler;
            AutomationPropertyChangedEventHandler propertyHandler = PropertyHandler;
            Automation.AddStructureChangedEventHandler(
                AutomationElement.RootElement,
                TreeScope.Subtree,
                structureHandler
            );
            Automation.AddAutomationPropertyChangedEventHandler(
                AutomationElement.RootElement,
                TreeScope.Subtree,
                propertyHandler,
                AutomationElement.NameProperty,
                AutomationElement.AutomationIdProperty,
                ValuePattern.ValueProperty
            );
            try
            {
                DateTime deadline = DateTime.UtcNow.AddSeconds(DefaultTimeoutSeconds);
                while (DateTime.UtcNow < deadline)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    try
                    {
                        AutomationElement? element = find();
                        if (element is not null)
                        {
                            return element;
                        }
                    }
                    catch (ElementNotAvailableException)
                    {
                        continue;
                    }
                    _ = changed.WaitOne(TimeSpan.FromMilliseconds(250));
                }
            }
            finally
            {
                Automation.RemoveStructureChangedEventHandler(
                    AutomationElement.RootElement,
                    structureHandler
                );
                Automation.RemoveAutomationPropertyChangedEventHandler(
                    AutomationElement.RootElement,
                    propertyHandler
                );
            }
            throw new AssertFailedException($"Timed out waiting for {description}.");
        }

        private static string ReadText(AutomationElement element)
        {
            if (
                element.TryGetCurrentPattern(TextPattern.Pattern, out object text)
                && text is TextPattern textPattern
            )
                return textPattern.DocumentRange.GetText(-1);
            return
                element.TryGetCurrentPattern(ValuePattern.Pattern, out object pattern)
                && pattern is ValuePattern valuePattern
                ? valuePattern.Current.Value
                : element.Current.Name;
        }

        private static void InvokeElement(AutomationElement element)
        {
            if (
                !element.TryGetCurrentPattern(InvokePattern.Pattern, out object pattern)
                || pattern is not InvokePattern invoke
            )
            {
                throw new AssertFailedException(
                    $"'{element.Current.Name}' does not expose the UIA Invoke pattern."
                );
            }
            invoke.Invoke();
        }

        private static void Select(AutomationElement element, bool add)
        {
            if (
                !element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object pattern)
                || pattern is not SelectionItemPattern selection
            )
            {
                throw new AssertFailedException(
                    $"'{element.Current.Name}' does not expose SelectionItem."
                );
            }
            if (add)
            {
                selection.AddToSelection();
            }
            else
            {
                selection.Select();
            }
        }

        private static AutomationElement? AscendToPattern(
            AutomationElement element,
            AutomationPattern pattern
        )
        {
            AutomationElement? current = element;
            while (current is not null && current != AutomationElement.RootElement)
            {
                if (current.TryGetCurrentPattern(pattern, out _))
                {
                    return current;
                }
                current = TreeWalker.ControlViewWalker.GetParent(current);
            }
            return null;
        }
    }
}
