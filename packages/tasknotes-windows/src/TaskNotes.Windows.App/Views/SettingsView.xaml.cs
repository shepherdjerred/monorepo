using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.App.Views
{
    /// <summary>Native settings fields and input events over portable view models.</summary>
    public sealed partial class SettingsView : UserControl
    {
        /// <summary>Identifies the shell view-model dependency property.</summary>
        public static readonly DependencyProperty ShellViewModelProperty =
            DependencyProperty.Register(
                nameof(ShellViewModel),
                typeof(ShellViewModel),
                typeof(SettingsView),
                new PropertyMetadata(null)
            );

        /// <summary>Identifies the settings view-model dependency property.</summary>
        public static readonly DependencyProperty ViewModelProperty = DependencyProperty.Register(
            nameof(ViewModel),
            typeof(SettingsViewModel),
            typeof(SettingsView),
            new PropertyMetadata(null, OnViewModelChanged)
        );

        private bool _settingTaskSounds;
        private bool _syncingToken;

        /// <summary>Initializes the compiled settings view.</summary>
        public SettingsView()
        {
            InitializeComponent();
        }

        /// <summary>Gets or sets shell state used for saved-view rows.</summary>
        public ShellViewModel? ShellViewModel
        {
            get => GetValue(ShellViewModelProperty) is ShellViewModel viewModel ? viewModel : null;
            set => SetValue(ShellViewModelProperty, value);
        }

        /// <summary>Gets or sets server configuration and parked-change state.</summary>
        public SettingsViewModel? ViewModel
        {
            get => GetValue(ViewModelProperty) is SettingsViewModel viewModel ? viewModel : null;
            set => SetValue(ViewModelProperty, value);
        }

        internal event RoutedEventHandler? SaveRequested;
        internal event Action<bool>? TaskSoundsChanged;
        internal event RoutedEventHandler? EnableRemindersRequested;
        internal event RoutedEventHandler? DisableRemindersRequested;
        internal event RoutedEventHandler? EnableBackgroundSyncRequested;
        internal event RoutedEventHandler? DisableBackgroundSyncRequested;
        internal event RoutedEventHandler? ApplyHotkeyRequested;
        internal event RoutedEventHandler? ClearHotkeyRequested;
        internal event RoutedEventHandler? CreateSavedViewRequested;
        internal event RoutedEventHandler? RestoreSavedViewsRequested;
        internal event RoutedEventHandler? DuplicateSavedViewRequested;
        internal event RoutedEventHandler? MoveSavedViewRequested;
        internal event RoutedEventHandler? DeleteSavedViewRequested;
        internal event RoutedEventHandler? RetryParkedRequested;
        internal event RoutedEventHandler? DiscardParkedRequested;

        internal void SetTaskSounds(bool enabled)
        {
            _settingTaskSounds = true;
            TaskSoundsToggle.IsOn = enabled;
            _settingTaskSounds = false;
        }

        internal void SyncTokenFromViewModel()
        {
            if (ViewModel is null)
                return;
            _syncingToken = true;
            try
            {
                TokenPasswordBox.Password = ViewModel.Token;
            }
            finally
            {
                _syncingToken = false;
            }
        }

        internal void SetBackgroundStatus(string status) => BackgroundSyncStatusText.Text = status;

        internal void SetReminderStatus(string status) => ReminderStatusText.Text = status;

        internal string Hotkey
        {
            get => HotkeyTextBox.Text;
            set => HotkeyTextBox.Text = value;
        }

        internal string ConnectionStatus
        {
            get => ConnectionStatusText.Text;
            set => ConnectionStatusText.Text = value;
        }

        internal string HotkeyStatus
        {
            get => HotkeyStatusText.Text;
            set => HotkeyStatusText.Text = value;
        }

        internal void FocusServerUrl()
        {
            _ = ServerUrlTextBox.Focus(FocusState.Programmatic);
        }

        private static void OnViewModelChanged(
            DependencyObject d,
            DependencyPropertyChangedEventArgs e
        )
        {
            if (d is SettingsView view)
                view.SyncTokenFromViewModel();
        }

        private void TokenPasswordBox_PasswordChanged(object sender, RoutedEventArgs args)
        {
            _ = sender;
            _ = args;
            if (!_syncingToken && ViewModel is not null)
                ViewModel.Token = TokenPasswordBox.Password;
        }

        private void TaskSounds_Toggled(object sender, RoutedEventArgs args)
        {
            _ = sender;
            _ = args;
            if (!_settingTaskSounds)
                TaskSoundsChanged?.Invoke(TaskSoundsToggle.IsOn);
        }

        private void EnableBackgroundSync_Click(object sender, RoutedEventArgs args) =>
            EnableBackgroundSyncRequested?.Invoke(sender, args);

        private void DisableBackgroundSync_Click(object sender, RoutedEventArgs args) =>
            DisableBackgroundSyncRequested?.Invoke(sender, args);

        private void EnableReminders_Click(object sender, RoutedEventArgs args) =>
            EnableRemindersRequested?.Invoke(sender, args);

        private void DisableReminders_Click(object sender, RoutedEventArgs args) =>
            DisableRemindersRequested?.Invoke(sender, args);

        private void Save_Click(object sender, RoutedEventArgs eventArgs) =>
            SaveRequested?.Invoke(sender, eventArgs);

        private void ApplyHotkey_Click(object sender, RoutedEventArgs eventArgs) =>
            ApplyHotkeyRequested?.Invoke(sender, eventArgs);

        private void ClearHotkey_Click(object sender, RoutedEventArgs eventArgs) =>
            ClearHotkeyRequested?.Invoke(sender, eventArgs);

        private void CreateSavedView_Click(object sender, RoutedEventArgs eventArgs) =>
            CreateSavedViewRequested?.Invoke(sender, eventArgs);

        private void RestoreSavedViews_Click(object sender, RoutedEventArgs eventArgs) =>
            RestoreSavedViewsRequested?.Invoke(sender, eventArgs);

        private void DuplicateSavedView_Click(object sender, RoutedEventArgs eventArgs) =>
            DuplicateSavedViewRequested?.Invoke(sender, eventArgs);

        private void MoveSavedView_Click(object sender, RoutedEventArgs eventArgs) =>
            MoveSavedViewRequested?.Invoke(sender, eventArgs);

        private void DeleteSavedView_Click(object sender, RoutedEventArgs eventArgs) =>
            DeleteSavedViewRequested?.Invoke(sender, eventArgs);

        private void RetryParked_Click(object sender, RoutedEventArgs eventArgs) =>
            RetryParkedRequested?.Invoke(sender, eventArgs);

        private void DiscardParked_Click(object sender, RoutedEventArgs eventArgs) =>
            DiscardParkedRequested?.Invoke(sender, eventArgs);
    }
}
