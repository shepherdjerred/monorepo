using Microsoft.UI.Xaml;

namespace TaskNotes.Windows.App.Tests
{
    /// <summary>Provides the XAML dispatcher that runs tests marked with UITestMethod.</summary>
    public sealed partial class TestWindow : Window
    {
        /// <summary>Initializes the WinUI test-host window.</summary>
        public TestWindow()
        {
            InitializeComponent();
        }
    }
}
