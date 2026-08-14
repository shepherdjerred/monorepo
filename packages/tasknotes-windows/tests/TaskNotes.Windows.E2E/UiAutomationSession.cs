using System.Diagnostics;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Text;
using System.Windows.Automation;

namespace TaskNotes.Windows.E2E
{
    internal sealed class UiAutomationSession : IAsyncDisposable
    {
        private const int DefaultTimeoutSeconds = 30;
        private readonly ScenarioConfiguration _configuration;
        private Process? _applicationProcess;

        private UiAutomationSession(ScenarioConfiguration configuration, AutomationElement window)
        {
            _configuration = configuration;
            Window = window;
            _applicationProcess = Process.GetProcessById(window.Current.ProcessId);
        }

        internal AutomationElement Window { get; private set; }

        internal static async Task<UiAutomationSession> LaunchAsync(
            ScenarioConfiguration configuration,
            CancellationToken cancellationToken
        )
        {
            StartPackage(configuration.PackageFamilyName);
            AutomationElement window = await Task.Run(
                () => WaitForRootWindow(cancellationToken),
                cancellationToken
            );
            return new UiAutomationSession(configuration, window);
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
                            )
                        )
                    ),
                $"combo box value '{value}'",
                CancellationToken.None
            );
            Select(item, false);
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

        internal static void ActivateProtocol(string uri)
        {
            _ = Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }

        internal void Focus()
        {
            Window.SetFocus();
        }

        internal async Task RestartAsync(CancellationToken cancellationToken)
        {
            CloseWindow();
            if (_applicationProcess is not null)
            {
                await _applicationProcess.WaitForExitAsync(cancellationToken);
                _applicationProcess.Dispose();
            }
            StartPackage(_configuration.PackageFamilyName);
            Window = await Task.Run(() => WaitForRootWindow(cancellationToken), cancellationToken);
            _applicationProcess = Process.GetProcessById(Window.Current.ProcessId);
        }

        internal async Task CaptureDiagnosticsAsync(
            string artifactDirectory,
            CancellationToken cancellationToken
        )
        {
            _ = Directory.CreateDirectory(artifactDirectory);
            await CaptureScreenshotAsync(
                Path.Combine(artifactDirectory, "failure.png"),
                cancellationToken
            );
            await File.WriteAllTextAsync(
                Path.Combine(artifactDirectory, "uia-tree.txt"),
                DescribeAutomationTree(Window),
                cancellationToken
            );
            string processInfo = _applicationProcess is null
                ? "application process unavailable"
                : $"pid={_applicationProcess.Id.ToString(CultureInfo.InvariantCulture)} name={_applicationProcess.ProcessName} exited={_applicationProcess.HasExited}";
            await File.WriteAllTextAsync(
                Path.Combine(artifactDirectory, "app-process.txt"),
                processInfo,
                cancellationToken
            );
        }

        internal Task CaptureScreenshotAsync(string path, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            System.Windows.Rect bounds = Window.Current.BoundingRectangle;
            if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0)
            {
                throw new AssertFailedException(
                    "The TaskNotes window has no capturable UIA bounds."
                );
            }
            int width = checked((int)Math.Ceiling(bounds.Width));
            int height = checked((int)Math.Ceiling(bounds.Height));
            using Bitmap bitmap = new(width, height, PixelFormat.Format32bppArgb);
            using Graphics graphics = Graphics.FromImage(bitmap);
            graphics.CopyFromScreen(
                checked((int)Math.Floor(bounds.Left)),
                checked((int)Math.Floor(bounds.Top)),
                0,
                0,
                new Size(width, height),
                CopyPixelOperation.SourceCopy
            );
            bitmap.Save(path, ImageFormat.Png);
            return Task.CompletedTask;
        }

        public async ValueTask DisposeAsync()
        {
            CloseWindow();
            if (_applicationProcess is not null)
            {
                if (!_applicationProcess.HasExited)
                {
                    _applicationProcess.Kill(true);
                }
                await _applicationProcess.WaitForExitAsync();
                _applicationProcess.Dispose();
                _applicationProcess = null;
            }
        }

        private static void StartPackage(string packageFamilyName)
        {
            ProcessStartInfo start = new(
                "explorer.exe",
                $"shell:AppsFolder\\{packageFamilyName}!App"
            )
            {
                UseShellExecute = true,
            };
            _ =
                Process.Start(start)
                ?? throw new InvalidOperationException("Unable to activate the E2E MSIX package.");
        }

        private static AutomationElement WaitForRootWindow(CancellationToken cancellationToken)
        {
            return WaitForCondition(
                () =>
                    AutomationElement.RootElement.FindFirst(
                        TreeScope.Children,
                        new AndCondition(
                            new PropertyCondition(AutomationElement.NameProperty, "TaskNotes E2E"),
                            new PropertyCondition(
                                AutomationElement.ControlTypeProperty,
                                ControlType.Window
                            )
                        )
                    ),
                "TaskNotes E2E top-level window",
                cancellationToken
            );
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
            AutomationElement? local = Window.FindFirst(TreeScope.Descendants, condition);
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

        private void CloseWindow()
        {
            try
            {
                if (
                    Window.TryGetCurrentPattern(WindowPattern.Pattern, out object pattern)
                    && pattern is WindowPattern window
                )
                {
                    window.Close();
                }
            }
            catch (ElementNotAvailableException)
            {
                return;
            }
        }

        private static string DescribeAutomationTree(AutomationElement root)
        {
            StringBuilder output = new();
            Describe(root, output, 0);
            return output.ToString();
        }

        private static void Describe(AutomationElement element, StringBuilder output, int depth)
        {
            if (depth > 20)
            {
                return;
            }
            try
            {
                _ = output
                    .Append(' ', depth * 2)
                    .Append(element.Current.ControlType.ProgrammaticName)
                    .Append(" name=")
                    .Append(JSON(element.Current.Name))
                    .Append(" id=")
                    .Append(JSON(element.Current.AutomationId))
                    .Append(" enabled=")
                    .Append(element.Current.IsEnabled)
                    .Append(" focusable=")
                    .Append(element.Current.IsKeyboardFocusable)
                    .AppendLine();
                AutomationElementCollection children = element.FindAll(
                    TreeScope.Children,
                    Condition.TrueCondition
                );
                foreach (AutomationElement child in children.Cast<AutomationElement>().Take(200))
                {
                    Describe(child, output, depth + 1);
                }
            }
            catch (ElementNotAvailableException)
            {
                _ = output.Append(' ', depth * 2).AppendLine("<element unavailable>");
            }
        }

        private static string JSON(string value)
        {
            return System.Text.Json.JsonSerializer.Serialize(value);
        }
    }
}
