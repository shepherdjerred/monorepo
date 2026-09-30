using Microsoft.UI.Xaml;

namespace HelloWinUI;

/// <summary>Opens the main window.</summary>
public partial class App : Application
{
    private Window? _window;

    /// <summary>Initializes the application resources.</summary>
    public App()
    {
        InitializeComponent();
    }

    /// <inheritdoc />
    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
    }
}
