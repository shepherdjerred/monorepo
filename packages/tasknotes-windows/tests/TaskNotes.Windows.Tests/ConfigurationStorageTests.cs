using TaskNotes.Windows.Host;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Verifies that public and secret settings remain physically separated.</summary>
    [TestClass]
    public sealed class ConfigurationStorageTests
    {
        /// <summary>Routes the server URL and token only to their dedicated stores.</summary>
        [TestMethod]
        public void SaveKeepsTheTokenOutOfLocalSettings()
        {
            CapturingServerUrlSettings serverUrlSettings = new();
            CapturingTokenSettings tokenSettings = new();
            TaskNotesConfigurationStorage storage = new(serverUrlSettings, tokenSettings);

            storage.Save("https://tasks.example.com", "top-secret");

            Assert.AreEqual("https://tasks.example.com", serverUrlSettings.SavedServerUrl);
            Assert.AreEqual("top-secret", tokenSettings.SavedToken);
        }

        /// <summary>Combines values loaded independently from the public and secret stores.</summary>
        [TestMethod]
        public void LoadReadsTheTwoStoresIndependently()
        {
            CapturingServerUrlSettings serverUrlSettings = new()
            {
                LoadedServerUrl = "https://tasks.example.com",
            };
            CapturingTokenSettings tokenSettings = new() { LoadedToken = "credential-token" };
            TaskNotesConfigurationStorage storage = new(serverUrlSettings, tokenSettings);

            TaskNotesConfiguration configuration = storage.Load();

            Assert.AreEqual(serverUrlSettings.LoadedServerUrl, configuration.ServerUrl);
            Assert.AreEqual(tokenSettings.LoadedToken, configuration.Token);
        }

        private sealed class CapturingServerUrlSettings : IServerUrlSettings
        {
            internal string? LoadedServerUrl { get; init; }

            internal string? SavedServerUrl { get; private set; }

            public string? Load()
            {
                return LoadedServerUrl;
            }

            public void Save(string serverUrl)
            {
                SavedServerUrl = serverUrl;
            }
        }

        private sealed class CapturingTokenSettings : ITokenSettings
        {
            internal string? LoadedToken { get; init; }

            internal string? SavedToken { get; private set; }

            public string? Load()
            {
                return LoadedToken;
            }

            public void Save(string? token)
            {
                SavedToken = token;
            }
        }
    }
}
