using System.Text.Json;
using System.Text.Json.Nodes;
using TaskNotes.Windows.App;
using TaskNotes.Windows.Host;
using TaskNotes.Windows.Presentation;

namespace TaskNotes.Windows.Tests;

/// <summary>Shared policy, native preference codec and physical attempt ownership without Windows APIs.</summary>
[TestClass]
public sealed class FeedbackPresentationTests
{
    /// <summary>The native adapter's checksum guard accepts all four source assets and rejects altered bytes.</summary>
    [TestMethod]
    public void PackagedSoundValidatorRequiresExactFirstPartyBytes()
    {
        DirectoryInfo? directory = new(AppContext.BaseDirectory);
        while (
            directory is not null
            && !Directory.Exists(
                Path.Combine(
                    directory.FullName,
                    "packages",
                    "tasknotes-fixtures",
                    "presentation",
                    "audio"
                )
            )
        )
            directory = directory.Parent;
        Assert.IsNotNull(directory, "The repository audio fixture producer is required.");
        var policy = FeedbackPolicy.Bundled();
        foreach (string cue in new[] { "create", "complete", "delete", "reverse" })
        {
            var bytes = File.ReadAllBytes(
                Path.Combine(
                    directory.FullName,
                    "packages",
                    "tasknotes-fixtures",
                    "presentation",
                    "audio",
                    cue + ".wav"
                )
            );
            policy.ValidateAsset(cue, bytes);
            bytes[0] ^= 1;
            Assert.ThrowsExactly<InvalidDataException>(() => policy.ValidateAsset(cue, bytes));
        }
    }

    /// <summary>Strict shared policy rejects missing/unknown fields and a palette checksum change.</summary>
    [TestMethod]
    public void BundledContractsAreStrictAndDefaultSoundsOn()
    {
        Assert.IsTrue(FeedbackPolicy.Bundled().DefaultSounds);
        string policy = Resource("FeedbackPolicy.json"),
            palette = Resource("FeedbackPalette.json"),
            schema = Resource("FeedbackSchema.json");
        var missing = JsonNode.Parse(policy)!.AsObject();
        missing.Remove("delivery");
        Assert.ThrowsExactly<InvalidDataException>(() =>
            new FeedbackPolicy(missing.ToJsonString(), palette, schema)
        );
        var extra = JsonNode.Parse(policy)!.AsObject();
        extra["unknown"] = true;
        Assert.ThrowsExactly<InvalidDataException>(() =>
            new FeedbackPolicy(extra.ToJsonString(), palette, schema)
        );
        var changed = JsonNode.Parse(palette)!;
        changed["cues"]!["create"]!["sha256"] = new string('0', 64);
        Assert.ThrowsExactly<InvalidDataException>(() =>
            new FeedbackPolicy(policy, changed.ToJsonString(), schema)
        );
    }

    /// <summary>At-most-once identity is engine/profile/mutation, independent of Saved notice generations.</summary>
    [TestMethod]
    public void ReceiptIdentityAndSilentEditsAreIndependentOfSoundPreference()
    {
        var policy = FeedbackPolicy.Bundled();
        var original = Outcome("a");
        Assert.AreEqual("create", policy.Observe(original, "p", true, true)?.Sound);
        Assert.IsNull(
            policy.Observe(
                original with
                {
                    Owner = original.Owner with { RequestGeneration = 99 },
                },
                "p",
                true,
                true
            )
        );
        Assert.IsNotNull(
            policy.Observe(original with { EngineSessionId = "other" }, "p", true, true)
        );
        Assert.IsNull(policy.Observe(Outcome("no-op") with { Changed = false }, "p", true, true));
        Assert.IsNotNull(policy.Observe(Outcome("muted"), "p", true, false));
        Assert.IsNull(
            policy.Observe(Outcome("edit") with { Event = "saved" }, "p", true, true)!.Sound
        );
        Assert.IsNull(policy.Observe(Outcome("wrong-profile"), "q", true, true));
        Assert.IsNull(policy.Observe(Outcome("background"), "p", false, true));
        Assert.IsNull(policy.Observe(Outcome("background"), "p", true, true));
    }

    /// <summary>Away-and-back before receipt or dispatch invalidates the original lease permanently.</summary>
    [TestMethod]
    public void OriginalSceneCannotReviveAfterDeactivation()
    {
        var scene = new FacetFeedbackScene();
        scene.SetForeground(true);
        var original = Outcome("scene") with { Origin = scene.Capture() };
        scene.SetForeground(false);
        scene.SetForeground(true);
        Assert.IsFalse(original.Origin.IsCurrent);
        Assert.IsNull(FeedbackPolicy.Bundled().Observe(original, "p", true, true));
        Assert.IsTrue(scene.Capture().IsCurrent);
        scene.Close();
        scene.SetForeground(true);
        Assert.IsFalse(scene.Capture().IsCurrent);
    }

    /// <summary>Producer-time spacing cannot allow queued dispatcher attempts to overlap or replay.</summary>
    [TestMethod]
    public void DurationGateClaimsAtPlaybackAndDropsOverlap()
    {
        var time = new Clock();
        var policy = new FeedbackPolicy(
            Resource("FeedbackPolicy.json"),
            Resource("FeedbackPalette.json"),
            Resource("FeedbackSchema.json"),
            time
        );
        Assert.IsNotNull(policy.Observe(Outcome("first"), "p", true, true));
        time.Advance(500);
        Assert.IsNotNull(policy.Observe(Outcome("second"), "p", true, true));
        Assert.IsTrue(policy.TryBeginPlayback("complete"));
        Assert.IsFalse(policy.TryBeginPlayback("create"));
        time.Advance(175);
        Assert.IsFalse(policy.TryBeginPlayback("delete"));
        time.Advance(1);
        Assert.IsTrue(policy.TryBeginPlayback("reverse"));
        Assert.IsNull(policy.Observe(Outcome("second"), "p", true, true));
    }

    /// <summary>Six seconds of confirmation pause while focused; lost ownership never returns.</summary>
    [TestMethod]
    public void ConfirmationPausesWhileFocusedAndKeepsExactReceipt()
    {
        var time = new Clock();
        var notice = new AppliedOutcomeNotice(time);
        var outcome = Outcome("receipt") with { Event = "completed" };
        notice.Show(outcome);
        time.Advance(5000);
        Assert.IsTrue(notice.Advance(false, true));
        time.Advance(999);
        Assert.IsTrue(notice.Advance(true, true));
        time.Advance(20000);
        Assert.IsTrue(notice.Advance(false, true));
        Assert.AreEqual("Task completed", notice.Title);
        Assert.AreSame(outcome, notice.Outcome);
        time.Advance(999);
        Assert.IsTrue(notice.Advance(false, true));
        time.Advance(1);
        Assert.IsFalse(notice.Advance(false, true));
        notice.Show(outcome);
        Assert.IsFalse(notice.Advance(false, false));
        Assert.IsFalse(notice.Advance(false, true));
    }

    /// <summary>A longer accessibility message duration is honored while short preferences retain the six-second floor.</summary>
    [TestMethod]
    public void ConfirmationHonorsNativeMessageDurationAndMinimum()
    {
        var time = new Clock();
        var notice = new AppliedOutcomeNotice(time);
        notice.Show(Outcome("accessible"), TimeSpan.FromSeconds(30));
        time.Advance(29999);
        Assert.IsTrue(notice.Advance(false, true));
        time.Advance(1);
        Assert.IsFalse(notice.Advance(false, true));
        notice.Show(Outcome("short"), TimeSpan.FromSeconds(1));
        time.Advance(5999);
        Assert.IsTrue(notice.Advance(false, true));
        time.Advance(1);
        Assert.IsFalse(notice.Advance(false, true));
    }

    /// <summary>Each receipt kind supplies truthful visible and accessible confirmation copy.</summary>
    [TestMethod]
    [DataRow("created", "Task added")]
    [DataRow("completed", "Task completed")]
    [DataRow("deleted", "Task deleted")]
    [DataRow("reopened", "Task reopened")]
    [DataRow("undone", "Change undone")]
    [DataRow("saved", "Saved")]
    public void ConfirmationCopyMatchesAppliedEvent(string action, string expected)
    {
        var notice = new AppliedOutcomeNotice();
        notice.Show(Outcome("copy") with { Event = action });
        Assert.AreEqual(expected, notice.Title);
    }

    /// <summary>Defaults enable sounds, explicit false survives all shell saves, malformed values demand recovery.</summary>
    [TestMethod]
    public void SoundPreferencesPreserveExplicitChoicesAndRejectMalformedValues()
    {
        Dictionary<string, object> values = [];
        Assert.IsTrue(ShellPreferencesCodec.Load(values).TaskSounds);
        values["task-sounds"] = false;
        var settings = ShellPreferencesCodec.Load(values);
        Assert.IsFalse(settings.TaskSounds);
        ShellPreferencesCodec.Save(values, settings with { InspectorVisible = false });
        Assert.IsFalse(ShellPreferencesCodec.Load(values).TaskSounds);
        values["task-sounds"] = "false";
        Assert.ThrowsExactly<InvalidDataException>(() => ShellPreferencesCodec.Load(values));
    }

    /// <summary>Homogeneous bulk has one cue; mixed edits and unrecognized semantic status remain silent.</summary>
    [TestMethod]
    public void CommandsUseOneAggregateCueWithoutInventedStatusSemantics()
    {
        using var complete = JsonDocument.Parse(
            """{"kind":"batch","commands":[{"kind":"set_completion","completed":true},{"kind":"set_completion","completed":true}]}"""
        );
        Assert.AreEqual("completed", FacetFeedbackEvents.Classify(complete.RootElement));
        using var mixed = JsonDocument.Parse(
            """{"kind":"batch","commands":[{"kind":"delete"},{"kind":"set_completion","completed":true}]}"""
        );
        Assert.AreEqual("saved", FacetFeedbackEvents.Classify(mixed.RootElement));
        using var status = JsonDocument.Parse("""{"kind":"set_status","status":"custom-done"}""");
        Assert.AreEqual("saved", FacetFeedbackEvents.Classify(status.RootElement));
    }

    private static FacetAppliedFeedback Outcome(string id) =>
        new("engine", new("p", id, 1, 1), "created", true, true);

    private static string Resource(string name)
    {
        using var stream = typeof(FeedbackPolicy).Assembly.GetManifestResourceStream(name)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    private sealed class Clock : TimeProvider
    {
        private long _timestamp;
        public override long TimestampFrequency => 1000;

        public override long GetTimestamp() => _timestamp;

        internal void Advance(long milliseconds) => _timestamp += milliseconds;
    }
}
