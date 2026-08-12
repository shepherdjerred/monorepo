using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using System.Runtime.ExceptionServices;
using System.Text;
using System.Text.Json;

namespace TaskNotes.Windows.Tests
{
    internal sealed class TaskNotesServerProcess : IDisposable
    {
        private readonly StringBuilder _output = new();
        private readonly Process _process;
        private bool _disposed;
        private readonly bool _started;

        private TaskNotesServerProcess(
            string authToken = "",
            IReadOnlyDictionary<string, string>? seedFiles = null
        )
        {
            AuthToken = authToken;
            VaultPath = Path.Combine(Path.GetTempPath(), $"tasknotes-server-{Guid.NewGuid():N}");
            _ = Directory.CreateDirectory(VaultPath);
            if (seedFiles is not null)
            {
                foreach (KeyValuePair<string, string> seed in seedFiles)
                {
                    string path = Path.Combine(VaultPath, seed.Key);
                    string parent =
                        Path.GetDirectoryName(path)
                        ?? throw new InvalidOperationException(
                            $"Seed path {path} has no parent directory."
                        );

                    _ = Directory.CreateDirectory(parent);
                    File.WriteAllText(path, seed.Value, new UTF8Encoding(false, true));
                }
            }

            int port = ReserveEphemeralPort();
            BaseUrl = new Uri($"http://127.0.0.1:{port}", UriKind.Absolute);
            ProcessStartInfo startInfo = new("bun", "run src/index.ts")
            {
                WorkingDirectory = ServerPackage,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            startInfo.Environment["VAULT_PATH"] = VaultPath;
            startInfo.Environment["PORT"] = port.ToString(
                System.Globalization.CultureInfo.InvariantCulture
            );
            startInfo.Environment["AUTH_TOKEN"] = authToken;
            startInfo.Environment["SENTRY_DSN"] = string.Empty;

            _process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            _process.OutputDataReceived += CaptureOutput;
            _process.ErrorDataReceived += CaptureOutput;
            try
            {
                if (!_process.Start())
                {
                    throw new InvalidOperationException(
                        "Bun did not start the TaskNotes server process."
                    );
                }

                _started = true;
                _process.BeginOutputReadLine();
                _process.BeginErrorReadLine();
            }
            catch
            {
                Dispose();
                throw;
            }
        }

        internal static async Task<TaskNotesServerProcess> StartAsync(
            string authToken = "",
            IReadOnlyDictionary<string, string>? seedFiles = null
        )
        {
            TaskNotesServerProcess server = new(authToken, seedFiles);
            try
            {
                await server.WaitUntilHealthyAsync().ConfigureAwait(false);
                return server;
            }
            catch (Exception startupFailure)
            {
                try
                {
                    server.Dispose();
                }
                catch (Exception cleanupFailure)
                {
                    startupFailure.Data["ServerCleanupFailure"] = cleanupFailure.GetType().FullName;
                }

                ExceptionDispatchInfo.Capture(startupFailure).Throw();
                throw new InvalidOperationException("Unreachable startup-failure path.");
            }
        }

        internal Uri BaseUrl { get; }

        internal string AuthToken { get; }

        internal string VaultPath { get; }

        internal string[] MarkdownFiles()
        {
            return
            [
                .. Directory
                    .GetFiles(VaultPath, "*.md", SearchOption.AllDirectories)
                    .Select(path => Path.GetRelativePath(VaultPath, path).Replace('\\', '/'))
                    .Order(StringComparer.Ordinal),
            ];
        }

        internal string Contents(string relativePath)
        {
            return File.ReadAllText(
                Path.Combine(VaultPath, relativePath),
                new UTF8Encoding(false, true)
            );
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            if (_started && !_process.HasExited)
            {
                _process.Kill(true);
                if (!_process.WaitForExit(10_000))
                {
                    throw new InvalidOperationException(
                        "The TaskNotes server process did not exit after termination."
                    );
                }
            }

            _process.Dispose();
            Directory.Delete(VaultPath, true);
        }

        private static string ServerPackage
        {
            get
            {
                string testsDirectory =
                    Path.GetDirectoryName(SourceFile())
                    ?? throw new InvalidOperationException(
                        "The test source path has no parent directory."
                    );

                return Path.GetFullPath(
                    Path.Combine(testsDirectory, "..", "..", "..", "tasknotes-server")
                );
            }
        }

        private static string SourceFile([CallerFilePath] string path = "")
        {
            return path;
        }

        private static int ReserveEphemeralPort()
        {
            TcpListener listener = new(IPAddress.Loopback, 0);
            listener.Start();
            try
            {
                return ((IPEndPoint)listener.LocalEndpoint).Port;
            }
            finally
            {
                listener.Stop();
            }
        }

        private async Task WaitUntilHealthyAsync()
        {
            using HttpClient client = new() { Timeout = TimeSpan.FromSeconds(1) };
            using CancellationTokenSource timeout = new(TimeSpan.FromSeconds(45));
            while (!timeout.IsCancellationRequested)
            {
                if (_process.HasExited)
                {
                    throw new InvalidOperationException(
                        $"The TaskNotes server exited during startup with code {_process.ExitCode}:{Environment.NewLine}{Output()}"
                    );
                }

                try
                {
                    using HttpResponseMessage response = await client
                        .GetAsync(new Uri(BaseUrl, "/api/health"), timeout.Token)
                        .ConfigureAwait(false);
                    if (response.StatusCode == HttpStatusCode.OK)
                    {
                        string json = await response
                            .Content.ReadAsStringAsync(timeout.Token)
                            .ConfigureAwait(false);
                        using JsonDocument document = JsonDocument.Parse(json);
                        bool authenticated = document
                            .RootElement.GetProperty("data")
                            .GetProperty("authenticated")
                            .GetBoolean();
                        bool expectedOpen = string.IsNullOrEmpty(AuthToken);
                        if (authenticated != expectedOpen)
                        {
                            throw new InvalidOperationException(
                                $"The server auth gate did not match AUTH_TOKEN; health authenticated={authenticated}."
                            );
                        }

                        return;
                    }
                }
                catch (HttpRequestException) when (!timeout.IsCancellationRequested) { }
                catch (TaskCanceledException) when (!timeout.IsCancellationRequested) { }
                catch (OperationCanceledException) when (timeout.IsCancellationRequested)
                {
                    break;
                }

                await Task.Delay(100).ConfigureAwait(false);
            }

            throw new InvalidOperationException(
                $"The TaskNotes server did not answer /api/health within 45 seconds:{Environment.NewLine}{Output()}"
            );
        }

        private void CaptureOutput(object sender, DataReceivedEventArgs args)
        {
            _ = sender;
            if (args.Data is null)
            {
                return;
            }

            lock (_output)
            {
                _ = _output.AppendLine(args.Data);
            }
        }

        private string Output()
        {
            lock (_output)
            {
                return _output.ToString();
            }
        }
    }
}
