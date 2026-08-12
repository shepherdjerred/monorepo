using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace TaskNotes.Windows.Tests
{
    /// <summary>Enforces portable project and generated-binding dependency boundaries.</summary>
    [TestClass]
    public sealed class ArchitectureTests
    {
        /// <summary>Checks that portable project references exclude WinUI and the application shell.</summary>
        [TestMethod]
        public void PortableProjectsDoNotReferenceWinUiOrTheApp()
        {
            string packageRoot = PackageRoot();
            XDocument host = XDocument.Load(
                Path.Combine(
                    packageRoot,
                    "src",
                    "TaskNotes.Windows.Host",
                    "TaskNotes.Windows.Host.csproj"
                )
            );
            XDocument presentation = XDocument.Load(
                Path.Combine(
                    packageRoot,
                    "src",
                    "TaskNotes.Windows.Presentation",
                    "TaskNotes.Windows.Presentation.csproj"
                )
            );

            Assert.IsFalse(
                ProjectReferences(host)
                    .Any(reference => reference.Contains("App", StringComparison.Ordinal))
            );
            Assert.IsFalse(
                ProjectReferences(presentation)
                    .Any(reference =>
                        reference.Contains("App", StringComparison.Ordinal)
                        || reference.Contains("Core.Bindings", StringComparison.Ordinal)
                    )
            );
            Assert.IsFalse(
                PackageReferences(host)
                    .Any(reference => reference.Contains("WindowsAppSDK", StringComparison.Ordinal))
            );
            Assert.IsFalse(
                PackageReferences(presentation)
                    .Any(reference => reference.Contains("WindowsAppSDK", StringComparison.Ordinal))
            );
        }

        /// <summary>Checks that only Host can cross into generated UniFFI code.</summary>
        [TestMethod]
        public void AppAndPresentationNeverCallGeneratedBindingsDirectly()
        {
            string packageRoot = PackageRoot();
            foreach (
                string project in new[]
                {
                    "TaskNotes.Windows.App",
                    "TaskNotes.Windows.Presentation",
                }
            )
            {
                string source = Path.Combine(packageRoot, "src", project);
                foreach (
                    string file in Directory.GetFiles(source, "*.cs", SearchOption.AllDirectories)
                )
                {
                    string contents = File.ReadAllText(file);
                    Assert.DoesNotContain(
                        "uniffi.",
                        contents,
                        $"{file} bypasses the Host boundary."
                    );
                }
            }
        }

        /// <summary>Checks that Host source remains independent of WinUI.</summary>
        [TestMethod]
        public void HostHasNoWinUiDependency()
        {
            string source = Path.Combine(PackageRoot(), "src", "TaskNotes.Windows.Host");
            foreach (string file in Directory.GetFiles(source, "*.cs", SearchOption.AllDirectories))
            {
                string contents = File.ReadAllText(file);
                Assert.DoesNotContain(
                    "Microsoft.UI",
                    contents,
                    $"{file} introduces UI-thread work into Host."
                );
            }
        }

        private static IEnumerable<string> ProjectReferences(XDocument document) =>
            document
                .Descendants("ProjectReference")
                .Select(element => element.Attribute("Include")?.Value)
                .OfType<string>();

        private static IEnumerable<string> PackageReferences(XDocument document) =>
            document
                .Descendants("PackageReference")
                .Select(element => element.Attribute("Include")?.Value)
                .OfType<string>();

        private static string PackageRoot([CallerFilePath] string sourceFile = "")
        {
            string directory =
                Path.GetDirectoryName(sourceFile)
                ?? throw new InvalidOperationException(
                    "The architecture test source path has no parent."
                );
            return Path.GetFullPath(Path.Combine(directory, "..", ".."));
        }
    }
}
