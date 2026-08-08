import { describe, expect, test } from "bun:test";

import {
  createCaptureRequest,
  deriveCaptureDraft,
  unparseCaptureChip,
} from "./quick-capture";
import {
  applyCaptureSuggestion,
  buildCaptureSuggestions,
} from "./quick-capture-autocomplete";
import {
  deriveProjectOptions,
  projectIdentityLabel,
  projectOptionLabel,
} from "./project-options";
import {
  captureSeedFromInitialText,
  captureSeedFromRouteParams,
  captureSessionFromSeed,
  clearCaptureSeedField,
  createCaptureSeed,
  resetCaptureSessionForAnother,
  setCaptureSeedProject,
} from "./quick-capture-seed";

const NOW = new Date(2026, 7, 8, 10, 30);

describe("CaptureSeed", () => {
  test("constructs the shared route seed from initial text", () => {
    expect(captureSeedFromInitialText("Call Sam tomorrow")).toEqual({
      version: 1,
      initialText: "Call Sam tomorrow",
    });
    expect(captureSeedFromInitialText(undefined)).toEqual({
      version: 1,
      initialText: "",
    });
  });

  test("normalizes source context and legacy deep-link params into one seed", () => {
    expect(
      captureSeedFromRouteParams({
        initialText: "Draft launch note",
        scheduled: "2026-08-08",
        due: "2026-08-11",
        project: "Launch Planning",
        priority: "high",
      }),
    ).toEqual({
      ok: true,
      value: {
        version: 1,
        initialText: "Draft launch note",
        scheduled: "2026-08-08",
        due: "2026-08-11",
        project: "Launch Planning",
        priority: "high",
      },
    });

    expect(captureSeedFromRouteParams({ initialText: "Legacy link" })).toEqual({
      ok: true,
      value: {
        version: 1,
        initialText: "Legacy link",
      },
    });

    expect(captureSeedFromRouteParams({ version: "1" })).toEqual({
      ok: true,
      value: {
        version: 1,
        initialText: "",
      },
    });
  });

  test("keeps internal source construction strict", () => {
    expect(() => createCaptureSeed({ scheduled: "2026-02-30" })).toThrow();
  });

  test("returns a friendly error for malformed external route params", () => {
    const impossibleDate = captureSeedFromRouteParams({
      scheduled: "2026-02-30",
    });
    const unknownPriority = captureSeedFromRouteParams({ priority: "urgent" });

    expect(impossibleDate.ok).toBe(false);
    expect(unknownPriority.ok).toBe(false);
    if (impossibleDate.ok || unknownPriority.ok) {
      throw new Error("Expected malformed capture routes to fail validation");
    }
    expect(impossibleDate.error.message).toBe(
      "This Quick Add link contains invalid task details.",
    );
    expect(unknownPriority.error.message).toBe(
      "This Quick Add link contains invalid task details.",
    );
  });

  test("clears one source default without disturbing the others", () => {
    const seed = createCaptureSeed({
      scheduled: "2026-08-08",
      project: "Launch Planning",
      priority: "high",
    });

    expect(clearCaptureSeedField(seed, "scheduled")).toEqual({
      version: 1,
      initialText: "",
      project: "Launch Planning",
      priority: "high",
    });
  });

  test("sets and clears a structured multiword project", () => {
    const seed = createCaptureSeed({
      scheduled: "2026-08-08",
      priority: "high",
    });
    const selected = setCaptureSeedProject(seed, "Launch Planning");

    expect(selected).toEqual({
      version: 1,
      initialText: "",
      scheduled: "2026-08-08",
      project: "Launch Planning",
      priority: "high",
    });
    expect(setCaptureSeedProject(selected, undefined)).toEqual(seed);
  });

  test("Save and Add Another resets input while preserving active defaults", () => {
    const seed = createCaptureSeed({
      scheduled: "2026-08-08",
      project: "Launch Planning",
    });
    const session = {
      ...captureSessionFromSeed(seed),
      text: "First task tomorrow",
      literalSources: [{ sourceText: "tomorrow", occurrence: 0 }],
    };

    expect(resetCaptureSessionForAnother(session)).toEqual({
      text: "",
      literalSources: [],
      seed,
    });
  });
});

describe("deriveCaptureDraft", () => {
  test("presents parsed metadata in a stable scan order", () => {
    const draft = deriveCaptureDraft(
      "Send brief tomorrow every friday p:Launch @work #review !high",
      [],
      NOW,
    );

    expect(draft.title).toBe("Send brief");
    expect(draft.chips.map((chip) => chip.kind)).toEqual([
      "deadline",
      "project",
      "priority",
      "recurrence",
      "context",
      "tag",
    ]);
    expect(draft.chips.map((chip) => chip.label)).toEqual([
      "Deadline · Tomorrow",
      "Project · Launch",
      "Priority · P2",
      "Repeats · Every Friday",
      "Context · work",
      "Tag · review",
    ]);
  });

  test("tapping a deadline chip returns its exact phrase to the title", () => {
    const input = "Review plan next week";
    const parsed = deriveCaptureDraft(input, [], NOW);
    const deadline = parsed.chips.find((chip) => chip.kind === "deadline");
    if (deadline === undefined) throw new Error("Expected deadline chip");
    if (deadline.origin !== "parsed") {
      throw new Error("Expected a parsed deadline chip");
    }

    const literalSources = unparseCaptureChip([], deadline);
    const unparsed = deriveCaptureDraft(input, literalSources, NOW);

    expect(unparsed.title).toBe("Review plan next week");
    expect(unparsed.parsed.due).toBeUndefined();
    expect(unparsed.chips).toEqual([]);
  });

  test("tapping a recurrence chip makes its source phrase literal", () => {
    const input = "Send report every friday";
    const parsed = deriveCaptureDraft(input, [], NOW);
    const recurrence = parsed.chips.find((chip) => chip.kind === "recurrence");
    if (recurrence === undefined) throw new Error("Expected recurrence chip");
    if (recurrence.origin !== "parsed") {
      throw new Error("Expected a parsed recurrence chip");
    }

    const unparsed = deriveCaptureDraft(
      input,
      unparseCaptureChip([], recurrence),
      NOW,
    );

    expect(unparsed.title).toBe("Send report every friday");
    expect(unparsed.parsed.recurrence).toBeUndefined();
  });

  test("parses and reversibly unparses a quoted multiword project", () => {
    const input = 'Prepare brief p:"Launch Planning"';
    const draft = deriveCaptureDraft(input, [], NOW);
    const project = draft.chips.find((chip) => chip.kind === "project");
    if (project === undefined) throw new Error("Expected project chip");
    if (project.origin !== "parsed") {
      throw new Error("Expected a parsed project chip");
    }

    expect(draft.title).toBe("Prepare brief");
    expect(draft.parsed.projects).toEqual(["Launch Planning"]);
    expect(project.value).toBe("Launch Planning");
    expect(project.source.sourceText).toBe('p:"Launch Planning"');
    expect(createCaptureRequest(draft).projects).toEqual(["Launch Planning"]);

    const literal = deriveCaptureDraft(
      input,
      unparseCaptureChip([], project),
      NOW,
    );
    expect(literal.title).toBe(input);
    expect(literal.parsed.projects).toBeUndefined();
    expect(literal.chips).toEqual([]);
  });

  test("unparses only the selected occurrence", () => {
    const input = "p:Work Draft p:Work";
    const parsed = deriveCaptureDraft(input, [], NOW);
    const project = parsed.chips[1];
    if (project === undefined) throw new Error("Expected second project chip");
    if (project.origin !== "parsed") {
      throw new Error("Expected a parsed project chip");
    }

    const unparsed = deriveCaptureDraft(
      input,
      unparseCaptureChip([], project),
      NOW,
    );

    expect(unparsed.title).toBe("Draft p:Work");
    expect(unparsed.parsed.projects).toEqual(["Work"]);
    expect(unparsed.chips).toHaveLength(1);
  });

  test("builds the existing optimistic create request without losing fields", () => {
    const draft = deriveCaptureDraft(
      "Send brief tomorrow every friday p:Launch @work #review !high",
      [],
      NOW,
    );

    expect(createCaptureRequest(draft)).toEqual({
      title: "Send brief",
      due: "2026-08-09",
      priority: "high",
      projects: ["Launch"],
      contexts: ["work"],
      tags: ["review"],
      recurrence: "FREQ=WEEKLY;BYDAY=FR",
    });
  });

  test("merges source defaults with parsed metadata using explicit input precedence", () => {
    const seed = createCaptureSeed({
      scheduled: "2026-08-08",
      due: "2026-08-11",
      project: "Launch Planning",
      priority: "low",
    });
    const draft = deriveCaptureDraft(
      "Send brief tomorrow p:Launch !high",
      [],
      NOW,
      seed,
    );

    expect(draft.chips.map((chip) => chip.label)).toEqual([
      "Planned · Today",
      "Deadline · Tomorrow",
      "Project · Launch Planning",
      "Project · Launch",
      "Priority · P2",
    ]);
    expect(createCaptureRequest(draft)).toEqual({
      title: "Send brief",
      scheduled: "2026-08-08",
      due: "2026-08-09",
      projects: ["Launch Planning", "Launch"],
      priority: "high",
    });
  });

  test("rejects metadata-only capture at the command boundary", () => {
    const draft = deriveCaptureDraft("tomorrow !high", [], NOW);
    expect(() => createCaptureRequest(draft)).toThrow();
  });
});

describe("capture autocomplete", () => {
  test("keeps same-named project paths distinct while deduping aliases", () => {
    const options = deriveProjectOptions([
      "[[Projects/Work]]",
      "[[Areas/Work]]",
      "[[Areas/Work|Office]]",
      "Home",
    ]);

    expect(options).toEqual([
      { identity: "Home", path: "Home", label: "Home" },
      {
        identity: "[[Areas/Work]]",
        path: "Areas/Work",
        label: "Work",
      },
      {
        identity: "[[Projects/Work]]",
        path: "Projects/Work",
        label: "Work",
      },
    ]);
    const areasWork = options[1];
    const projectsWork = options[2];
    if (areasWork === undefined || projectsWork === undefined) {
      throw new Error("Expected both Work project options");
    }
    expect(projectOptionLabel(areasWork, options)).toBe("Areas/Work");
    expect(projectOptionLabel(projectsWork, options)).toBe("Projects/Work");
    expect(projectIdentityLabel("[[Areas/Work|Office]]", options)).toBe(
      "Areas/Work",
    );
  });

  test("completes single and multiword projects plus context and tag tokens", () => {
    expect(
      buildCaptureSuggestions(
        "Plan p:La",
        deriveProjectOptions(["Launch", "Large Project"]),
        [],
        [],
      ),
    ).toEqual([
      {
        key: "project:Large Project",
        token: 'p:"Large Project"',
        label: "p:Large Project",
      },
      {
        key: "project:Launch",
        token: "p:Launch",
        label: "p:Launch",
      },
    ]);
    expect(buildCaptureSuggestions("Call @ph", [], ["phone"], [])).toEqual([
      { key: "@phone", token: "@phone", label: "@phone" },
    ]);
    expect(buildCaptureSuggestions("Review #ur", [], [], ["urgent"])).toEqual([
      { key: "#urgent", token: "#urgent", label: "#urgent" },
    ]);
  });

  test("replaces only the trailing token and preserves earlier text", () => {
    const suggestion = buildCaptureSuggestions(
      "Plan launch p:La",
      deriveProjectOptions(["Launch"]),
      [],
      [],
    )[0];
    if (suggestion === undefined) throw new Error("Expected suggestion");

    expect(applyCaptureSuggestion("Plan launch p:La", suggestion)).toBe(
      "Plan launch p:Launch ",
    );
  });

  test("applies a multiword project suggestion as parseable quoted input", () => {
    const suggestion = buildCaptureSuggestions(
      "Plan launch p:La",
      deriveProjectOptions(["Large Project"]),
      [],
      [],
    )[0];
    if (suggestion === undefined) throw new Error("Expected suggestion");

    const input = applyCaptureSuggestion("Plan launch p:La", suggestion);
    expect(input).toBe('Plan launch p:"Large Project" ');
    const draft = deriveCaptureDraft(input, [], NOW);
    expect(draft.title).toBe("Plan launch");
    expect(draft.parsed.projects).toEqual(["Large Project"]);
  });

  test("inserts the exact canonical identity for ambiguous project names", () => {
    const options = deriveProjectOptions([
      "[[Areas/Work]]",
      "[[Projects/Work]]",
    ]);
    const suggestions = buildCaptureSuggestions("Plan p:Wo", options, [], []);

    expect(suggestions).toEqual([
      {
        key: "project:[[Areas/Work]]",
        token: "p:[[Areas/Work]]",
        label: "p:Areas/Work",
      },
      {
        key: "project:[[Projects/Work]]",
        token: "p:[[Projects/Work]]",
        label: "p:Projects/Work",
      },
    ]);

    const projectsWork = suggestions[1];
    if (projectsWork === undefined) {
      throw new Error("Expected Projects/Work suggestion");
    }
    const input = applyCaptureSuggestion("Plan p:Wo", projectsWork);
    expect(deriveCaptureDraft(input, [], NOW).parsed.projects).toEqual([
      "[[Projects/Work]]",
    ]);
  });
});
