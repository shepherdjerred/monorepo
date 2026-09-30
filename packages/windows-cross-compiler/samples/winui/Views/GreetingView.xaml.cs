using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace HelloWinUI.Views;

/// <summary>A page in a subfolder, so XAML output paths keep their directory.</summary>
public sealed partial class GreetingView : UserControl
{
    /// <summary>Creates the view.</summary>
    public GreetingView()
    {
        InitializeComponent();
    }

    private void OnGreet(object sender, RoutedEventArgs e)
    {
        GreetButton.Content = "Hello from Windows";
    }
}
