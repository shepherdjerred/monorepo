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
            typeof(FacetSettingsViewModel),
            typeof(SettingsView),
            new PropertyMetadata(null)
        );

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

        /// <summary>Gets or sets settings and parked-change state.</summary>
        public FacetSettingsViewModel? ViewModel
        {
            get =>
                GetValue(ViewModelProperty) is FacetSettingsViewModel viewModel ? viewModel : null;
            set => SetValue(ViewModelProperty, value);
        }

        internal event RoutedEventHandler? SaveRequested;

        internal void SetBackgroundStatus(string status) => BackgroundSyncStatusText.Text = status;

        internal void SetReminderStatus(string status) => ReminderStatusText.Text = status;

        internal event RoutedEventHandler? EnableRemindersRequested;
        internal event RoutedEventHandler? DisableRemindersRequested;
        internal event RoutedEventHandler? EnableBackgroundSyncRequested;
        internal event RoutedEventHandler? DisableBackgroundSyncRequested;

        private void EnableBackgroundSync_Click(object sender, RoutedEventArgs args) =>
            EnableBackgroundSyncRequested?.Invoke(sender, args);

        private void DisableBackgroundSync_Click(object sender, RoutedEventArgs args) =>
            DisableBackgroundSyncRequested?.Invoke(sender, args);

        private void EnableReminders_Click(object sender, RoutedEventArgs args) =>
            EnableRemindersRequested?.Invoke(sender, args);

        private void DisableReminders_Click(object sender, RoutedEventArgs args) =>
            DisableRemindersRequested?.Invoke(sender, args);

        internal event RoutedEventHandler? ConnectVaultRequested;
        internal event RoutedEventHandler? SelectProfileRequested;
        internal event RoutedEventHandler? RemoveProfileRequested;
        internal event RoutedEventHandler? LocalFolderRequested;
        internal event RoutedEventHandler? SignOutRequested;
        internal event RoutedEventHandler? ReauthorizeRequested;
        internal event RoutedEventHandler? ApplyHotkeyRequested;
        internal event RoutedEventHandler? ClearHotkeyRequested;
        internal event RoutedEventHandler? CreateSavedViewRequested;
        internal event RoutedEventHandler? RestoreSavedViewsRequested;
        internal event RoutedEventHandler? DuplicateSavedViewRequested;
        internal event RoutedEventHandler? MoveSavedViewRequested;
        internal event RoutedEventHandler? DeleteSavedViewRequested;
        internal event RoutedEventHandler? RetryParkedRequested;
        internal event RoutedEventHandler? DiscardParkedRequested;
        internal event RoutedEventHandler? ReviewConflictRequested;
        internal event RoutedEventHandler? ResumeActionRequested;
        internal event RoutedEventHandler? RetireActionRequested;

        internal string Email => EmailTextBox.Text;
        internal string Password => AccountPasswordBox.Password;
        internal string Mfa => MfaTextBox.Text;
        internal string VaultPassword => VaultPasswordBox.Password;
        internal bool ApproveStandard => ApproveStandardCheckBox.IsChecked == true;
        internal Host.ObsidianVaultChoice? SelectedVault =>
            VaultComboBox.SelectedItem as Host.ObsidianVaultChoice;
        internal Host.FacetProfileRegistration? SelectedProfile =>
            ProfileComboBox.SelectedItem as Host.FacetProfileRegistration;

        internal void ClearAccountSecrets()
        {
            AccountPasswordBox.Password = "";
            MfaTextBox.Text = "";
        }

        internal void ClearVaultPassword() => VaultPasswordBox.Password = "";

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

        internal void FocusAccount()
        {
            _ = EmailTextBox.Focus(FocusState.Programmatic);
        }

        private void ConnectVault_Click(object sender, RoutedEventArgs args) =>
            ConnectVaultRequested?.Invoke(sender, args);

        private void SelectProfile_Click(object sender, RoutedEventArgs args) =>
            SelectProfileRequested?.Invoke(sender, args);

        private void RemoveProfile_Click(object sender, RoutedEventArgs args) =>
            RemoveProfileRequested?.Invoke(sender, args);

        private void LocalFolder_Click(object sender, RoutedEventArgs args) =>
            LocalFolderRequested?.Invoke(sender, args);

        private void SignOut_Click(object sender, RoutedEventArgs args) =>
            SignOutRequested?.Invoke(sender, args);

        private void Reauthorize_Click(object sender, RoutedEventArgs args) =>
            ReauthorizeRequested?.Invoke(sender, args);

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

        private void ReviewConflict_Click(object sender, RoutedEventArgs args) =>
            ReviewConflictRequested?.Invoke(sender, args);

        private void ResumeAction_Click(object sender, RoutedEventArgs args) =>
            ResumeActionRequested?.Invoke(sender, args);

        private void RetireAction_Click(object sender, RoutedEventArgs args) =>
            RetireActionRequested?.Invoke(sender, args);
    }
}
