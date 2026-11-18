using TaskNotes.Protocol;
using TaskNotes.Windows.Host;
using ProtocolTask = TaskNotes.Protocol.Task;

namespace TaskNotes.Windows.Tests;

/// <summary>Verifies transactional Microsoft.Data.Sqlite cache mutations, outbox reconciliation, and temp_id remapping.</summary>
[TestClass]
public sealed class FacetSqliteCacheTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 8, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Applies all 21 SyncCommand variants optimistically and persists state across file reopens.</summary>
    [TestMethod]
    public void EnqueueAndApplyCoversAllCommandVariantsAndPersistsToDisk()
    {
        using TemporaryDirectory directory = new();
        using (FacetSqliteCache cache = FacetSqliteCache.OpenDirectory(directory.Path))
        {
            FacetCacheSnapshot seeded = cache.EnqueueAndApply(
                [
                    new QueuedCommand(
                        "u-p1",
                        "tmp-proj",
                        new SyncCommand.ProjectAdd(
                            new ProjectAddArgs(Name: "Work", Color: "#112233", IsFavorite: true)
                        )
                    ),
                    new QueuedCommand(
                        "u-s1",
                        "tmp-sec",
                        new SyncCommand.SectionAdd(
                            new SectionAddArgs(
                                ProjectId: "tmp-proj",
                                Name: "Sprint",
                                SectionOrder: 1
                            )
                        )
                    ),
                    new QueuedCommand(
                        "u-l1",
                        "tmp-lbl",
                        new SyncCommand.LabelAdd(new LabelAddArgs(Name: "urgent", Color: "#FF0000"))
                    ),
                    new QueuedCommand(
                        "u-f1",
                        "tmp-flt",
                        new SyncCommand.FilterAdd(
                            new FilterAddArgs(Name: "Focus", Query: "p1", Color: "#00FF00")
                        )
                    ),
                    new QueuedCommand(
                        "u-t1",
                        "tmp-task",
                        new SyncCommand.TaskAdd(
                            new TaskAddArgs(
                                ProjectId: "tmp-proj",
                                Title: "Ship",
                                Description: "v1",
                                Priority: Priority.P2,
                                SectionId: "tmp-sec",
                                DueDate: "2026-10-08",
                                RecurrenceRule: "FREQ=DAILY",
                                LabelIds: ["tmp-lbl"]
                            )
                        )
                    ),
                    new QueuedCommand(
                        "u-r1",
                        "tmp-rem",
                        new SyncCommand.ReminderAdd(
                            new ReminderAddArgs(
                                TaskId: "tmp-task",
                                ReminderType: "relative",
                                MinuteOffset: 15
                            )
                        )
                    ),
                ],
                Now
            );

            Assert.HasCount(1, seeded.Projects);
            Assert.HasCount(1, seeded.Sections);
            Assert.HasCount(1, seeded.Labels);
            Assert.HasCount(1, seeded.Filters);
            Assert.HasCount(1, seeded.Tasks);
            Assert.HasCount(1, seeded.Reminders);
            Assert.HasCount(6, seeded.Outbox);

            FacetCacheSnapshot mutated = cache.EnqueueAndApply(
                [
                    new QueuedCommand(
                        "u-pu",
                        null,
                        new SyncCommand.ProjectUpdate(
                            new ProjectUpdateArgs(
                                Id: "tmp-proj",
                                Name: "Work Updated",
                                ParentId: "",
                                IsArchived: false
                            )
                        )
                    ),
                    new QueuedCommand(
                        "u-su",
                        null,
                        new SyncCommand.SectionUpdate(
                            new SectionUpdateArgs(Id: "tmp-sec", Name: "Sprint 2", SectionOrder: 3)
                        )
                    ),
                    new QueuedCommand(
                        "u-lu",
                        null,
                        new SyncCommand.LabelUpdate(
                            new LabelUpdateArgs(Id: "tmp-lbl", Name: "critical", IsFavorite: true)
                        )
                    ),
                    new QueuedCommand(
                        "u-fu",
                        null,
                        new SyncCommand.FilterUpdate(
                            new FilterUpdateArgs(Id: "tmp-flt", Name: "Top Focus", Query: "today")
                        )
                    ),
                    new QueuedCommand(
                        "u-ru",
                        null,
                        new SyncCommand.ReminderUpdate(
                            new ReminderUpdateArgs(
                                Id: "tmp-rem",
                                ReminderType: "absolute",
                                DueDatetime: "2026-10-09T09:00:00Z",
                                IsNotified: true
                            )
                        )
                    ),
                    new QueuedCommand(
                        "u-tr",
                        null,
                        new SyncCommand.TaskReorder(new TaskReorderArgs("tmp-task", 7.5))
                    ),
                    new QueuedCommand(
                        "u-tc",
                        null,
                        new SyncCommand.TaskComplete(new TaskCompleteArgs("tmp-task"))
                    ),
                ],
                Now
            );

            ProtocolTask advancedRecurring = mutated.Tasks.Single();
            Assert.IsFalse(advancedRecurring.Completed);
            Assert.AreEqual("2026-10-09", advancedRecurring.DueDate);
            Assert.AreEqual(7.5, advancedRecurring.ChildOrder);
            Assert.AreEqual("Work Updated", mutated.Projects.Single().Name);
            Assert.AreEqual("Sprint 2", mutated.Sections.Single().Name);
            Assert.AreEqual("critical", mutated.Labels.Single().Name);
            Assert.AreEqual("Top Focus", mutated.Filters.Single().Name);
            Assert.AreEqual("absolute", mutated.Reminders.Single().ReminderType);

            FacetCacheSnapshot cleared = cache.EnqueueAndApply(
                [
                    new QueuedCommand(
                        "u-tu",
                        null,
                        new SyncCommand.TaskUpdate(
                            new TaskUpdateArgs(
                                Id: "tmp-task",
                                Title: "One-off",
                                DueDate: "",
                                RecurrenceRule: "",
                                SectionId: "",
                                ParentId: ""
                            )
                        )
                    ),
                    new QueuedCommand(
                        "u-tc2",
                        null,
                        new SyncCommand.TaskComplete(new TaskCompleteArgs("tmp-task"))
                    ),
                    new QueuedCommand(
                        "u-tuc",
                        null,
                        new SyncCommand.TaskUncomplete(new TaskUncompleteArgs("tmp-task"))
                    ),
                ],
                Now
            );
            ProtocolTask oneOff = cleared.Tasks.Single();
            Assert.IsNull(oneOff.DueDate);
            Assert.IsNull(oneOff.RecurrenceRule);
            Assert.IsFalse(oneOff.IsRecurring);
            Assert.IsNull(oneOff.SectionId);
            Assert.IsFalse(oneOff.Completed);
        }

        using FacetSqliteCache reopened = FacetSqliteCache.OpenDirectory(directory.Path);
        FacetCacheSnapshot diskSnapshot = reopened.ReadSnapshot();
        Assert.AreEqual("One-off", diskSnapshot.Tasks.Single().Title);
        Assert.HasCount(16, diskSnapshot.Outbox);

        FacetCacheSnapshot deleted = reopened.EnqueueAndApply(
            [
                new QueuedCommand(
                    "u-rd",
                    null,
                    new SyncCommand.ReminderDelete(new ReminderDeleteArgs("tmp-rem"))
                ),
                new QueuedCommand(
                    "u-sd",
                    null,
                    new SyncCommand.SectionDelete(new SectionDeleteArgs("tmp-sec"))
                ),
                new QueuedCommand(
                    "u-ld",
                    null,
                    new SyncCommand.LabelDelete(new LabelDeleteArgs("tmp-lbl"))
                ),
                new QueuedCommand(
                    "u-fd",
                    null,
                    new SyncCommand.FilterDelete(new FilterDeleteArgs("tmp-flt"))
                ),
                new QueuedCommand(
                    "u-td",
                    null,
                    new SyncCommand.TaskDelete(new TaskDeleteArgs("tmp-task"))
                ),
                new QueuedCommand(
                    "u-pd",
                    null,
                    new SyncCommand.ProjectDelete(new ProjectDeleteArgs("tmp-proj"))
                ),
            ],
            Now
        );
        Assert.IsEmpty(deleted.Reminders);
        Assert.IsEmpty(deleted.Sections);
        Assert.IsEmpty(deleted.Labels);
        Assert.IsEmpty(deleted.Filters);
        Assert.IsEmpty(deleted.Tasks);
        Assert.IsEmpty(deleted.Projects);
    }

    /// <summary>Remaps temp_id across entities and queued outbox commands, parks errors, and handles full + delta sync.</summary>
    [TestMethod]
    public void ApplySyncResponseRemapsTempIdsReplaysUnsentOutboxAndManagesParkedErrors()
    {
        using FacetSqliteCache cache = FacetSqliteCache.OpenSharedMemory();
        cache.EnqueueAndApply(
            [
                new QueuedCommand(
                    "cmd-proj",
                    "tmp-proj",
                    new SyncCommand.ProjectAdd(new ProjectAddArgs(Name: "Roadmap"))
                ),
                new QueuedCommand(
                    "cmd-lbl",
                    "tmp-lbl",
                    new SyncCommand.LabelAdd(new LabelAddArgs(Name: "next"))
                ),
                new QueuedCommand(
                    "cmd-task",
                    "tmp-task",
                    new SyncCommand.TaskAdd(
                        new TaskAddArgs(
                            ProjectId: "tmp-proj",
                            Title: "Draft",
                            LabelIds: ["tmp-lbl"]
                        )
                    )
                ),
                new QueuedCommand(
                    "cmd-bad-temp",
                    "tmp-rejected",
                    new SyncCommand.ProjectAdd(new ProjectAddArgs(Name: "Rejected"))
                ),
                new QueuedCommand(
                    "cmd-later-edit",
                    null,
                    new SyncCommand.TaskUpdate(
                        new TaskUpdateArgs(
                            Id: "tmp-task",
                            ProjectId: "tmp-proj",
                            Title: "Unsent Edit",
                            LabelIds: ["tmp-lbl"]
                        )
                    )
                ),
            ],
            Now
        );

        SyncResponse fullResponse = ProtocolTestFactory.EmptySyncResponse(
            syncToken: "seq:10",
            fullSync: true,
            tempIdMapping: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["tmp-proj"] = "srv-proj",
                ["tmp-lbl"] = "srv-lbl",
                ["tmp-task"] = "srv-task",
            },
            syncStatus: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["cmd-proj"] = "ok",
                ["cmd-lbl"] = "ok",
                ["cmd-task"] = "ok",
                ["cmd-bad-temp"] = "error: Project limit exceeded",
            },
            projects: [ProtocolTestFactory.MakeProject("srv-proj", "Roadmap")],
            labels: [ProtocolTestFactory.MakeLabel("srv-lbl", "next")],
            tasks:
            [
                ProtocolTestFactory.MakeTask(
                    "srv-task",
                    "srv-proj",
                    "Draft",
                    labelIds: ["srv-lbl"]
                ),
            ]
        );

        HashSet<string> sent = ["cmd-proj", "cmd-lbl", "cmd-task", "cmd-bad-temp"];
        FacetCacheSnapshot afterFull = cache.ApplySyncResponse(
            fullResponse,
            sent,
            Now,
            "https://facet.example"
        );

        Assert.AreEqual("seq:10", afterFull.SyncToken);
        Assert.AreEqual("https://facet.example", afterFull.ServerUrl);
        Assert.HasCount(1, afterFull.Projects);
        Assert.AreEqual("srv-proj", afterFull.Projects[0].Id);
        Assert.HasCount(1, afterFull.Tasks);
        Assert.AreEqual("srv-task", afterFull.Tasks[0].Id);
        Assert.AreEqual("Unsent Edit", afterFull.Tasks[0].Title);

        QueuedCommand remaining = afterFull.Outbox.Single();
        Assert.AreEqual("cmd-later-edit", remaining.Uuid);
        SyncCommand.TaskUpdate remappedEdit = Assert.IsInstanceOfType<SyncCommand.TaskUpdate>(
            remaining.Command
        );
        Assert.AreEqual("srv-task", remappedEdit.Args.Id);
        Assert.AreEqual("srv-proj", remappedEdit.Args.ProjectId);
        Assert.AreSequenceEqual(["srv-lbl"], remappedEdit.Args.LabelIds!);

        ParkedCommandRecord parked = afterFull.ParkedMutations.Single();
        Assert.AreEqual("cmd-bad-temp", parked.Id);
        Assert.AreEqual("Project limit exceeded", parked.Message);

        FacetCacheSnapshot retried = cache.RetryParkedMutation("cmd-bad-temp", "cmd-retry", Now);
        Assert.IsEmpty(retried.ParkedMutations);
        Assert.HasCount(2, retried.Outbox);

        SyncResponse deltaResponse = ProtocolTestFactory.EmptySyncResponse(
            syncToken: "seq:12",
            fullSync: false,
            syncStatus: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["cmd-later-edit"] = "ok",
                ["cmd-retry"] = "error: Still rejected",
            },
            tasks:
            [
                ProtocolTestFactory.MakeTask("srv-task", "srv-proj", "Deleted", isDeleted: true),
            ]
        );
        FacetCacheSnapshot afterDelta = cache.ApplySyncResponse(
            deltaResponse,
            new HashSet<string>(["cmd-later-edit", "cmd-retry"], StringComparer.Ordinal),
            Now,
            "https://facet.example"
        );
        Assert.IsEmpty(afterDelta.Tasks);
        Assert.IsEmpty(afterDelta.Outbox);
        Assert.HasCount(1, afterDelta.ParkedMutations);

        FacetCacheSnapshot discarded = cache.DiscardParkedMutation("cmd-retry");
        Assert.IsEmpty(discarded.ParkedMutations);

        FacetCacheSnapshot reset = cache.ResetForServer("https://other.example");
        Assert.IsNull(reset.SyncToken);
        Assert.AreEqual("https://other.example", reset.ServerUrl);
        Assert.IsEmpty(reset.Projects);

        cache.Dispose();
        _ = Assert.ThrowsExactly<ObjectDisposedException>(() => cache.ReadSnapshot());
    }
}
