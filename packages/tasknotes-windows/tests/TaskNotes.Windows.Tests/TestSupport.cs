namespace TaskNotes.Windows.Tests
{
    internal sealed class TemporaryDirectory : IDisposable
    {
        internal TemporaryDirectory()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                $"tasknotes-windows-{Guid.NewGuid():N}"
            );
            _ = Directory.CreateDirectory(Path);
        }

        internal string Path { get; }

        public void Dispose()
        {
            Directory.Delete(Path, true);
        }
    }

    internal static class InterlockedExtensions
    {
        internal static void Max(ref int location, int value)
        {
            int current = Volatile.Read(ref location);
            while (current < value)
            {
                int observed = Interlocked.CompareExchange(ref location, value, current);
                if (observed == current)
                {
                    return;
                }

                current = observed;
            }
        }
    }

    /// <summary>Resolves repository paths from the runtime assembly rather than source paths.</summary>
    internal static class PackagePaths
    {
        private const string PortableSolutionFile = "TaskNotes.Windows.Portable.slnx";

        /// <summary>Gets the tasknotes-windows package root.</summary>
        /// <remarks>
        /// Deliberately not [CallerFilePath]. Directory.Build.props turns
        /// ContinuousIntegrationBuild on whenever CI is set, which remaps embedded source
        /// paths to /_/..., a location that does not exist at runtime, so tests resolving
        /// the compile-time path failed only in CI. Walking up from the assembly is also
        /// independent of the configuration and target framework in the output path.
        /// </remarks>
        internal static string PackageRoot()
        {
            for (
                DirectoryInfo? candidate = new(AppContext.BaseDirectory);
                candidate is not null;
                candidate = candidate.Parent
            )
            {
                if (File.Exists(Path.Combine(candidate.FullName, PortableSolutionFile)))
                {
                    return candidate.FullName;
                }
            }

            throw new InvalidOperationException(
                $"No ancestor of {AppContext.BaseDirectory} contains {PortableSolutionFile}."
            );
        }

        /// <summary>Gets a sibling package directory inside the same workspace.</summary>
        internal static string SiblingPackage(string name)
        {
            string packages =
                Path.GetDirectoryName(PackageRoot())
                ?? throw new InvalidOperationException("The package root has no parent directory.");
            return Path.Combine(packages, name);
        }
    }
}
