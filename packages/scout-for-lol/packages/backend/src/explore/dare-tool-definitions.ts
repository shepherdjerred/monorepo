import { tool } from "ai";
import { z } from "zod";
import { createDareToolExecutors } from "#src/explore/dare-tools.ts";
import type { DareExploreToolsInput } from "#src/explore/dare-tool-context.ts";
import {
  DareActionToolInputSchema,
  DareDefinitionToolInputSchema,
  DareDeleteToolInputSchema,
  DareInspectToolInputSchema,
  DareListToolInputSchema,
  DarePreviewToolInputSchema,
  DareScoutQlToolInputSchema,
  DareToolResultSchema,
  ReviseDareToolInputSchema,
} from "#src/explore/dare-tool-schemas.ts";

export function createDareExploreTools(input: DareExploreToolsInput) {
  const executors = createDareToolExecutors(input);
  return {
    get_dare_language: tool({
      description:
        "Load the active Dare authoring version, frozen T1-T5 targets, standard-SQL relation catalog, defaults, and hard limits. Call this first.",
      inputSchema: z.strictObject({}),
      outputSchema: DareToolResultSchema,
      execute: () => executors.language(),
    }),
    validate_dare_contract: tool({
      description:
        "Validate and historically preview the active Dare contract format without saving it. In v3, canonical standard SQL is binding.",
      inputSchema: DareDefinitionToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.validate(raw),
    }),
    validate_dare_scoutql: tool({
      description:
        "Parse, validate, and canonically format a Dare query. V3 uses standard SQL over normalized relations and T1-T5, with no custom Dare functions.",
      inputSchema: DareScoutQlToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.validateScoutQl(raw),
    }),
    preview_dare_contract: tool({
      description:
        "Execute a valid Dare contract against retained lake data. Returns true, false, or null plus explicit timeline coverage and source match IDs.",
      inputSchema: DarePreviewToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.preview(raw),
    }),
    create_dare_draft: tool({
      description:
        "Save a private, unfunded Dare draft after validation and historical execution. In v3, one-game wording belongs in one game-set CTE.",
      inputSchema: DareDefinitionToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.create(raw),
    }),
    revise_dare_draft: tool({
      description:
        "Append a validated revision to a private, unfunded Dare draft. Requires the exact current revision and never mutates a funded contract.",
      inputSchema: ReviseDareToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.revise(raw),
    }),
    list_dares: tool({
      description:
        "List the requester's dares (authored, targeted, or funded) or every funded guild-visible dare, with status and progress.",
      inputSchema: DareListToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.list(raw),
    }),
    inspect_dare: tool({
      description:
        "Inspect one visible dare, including its frozen SQL, exact meaning, targets, acceptance, progress, result, and proof.",
      inputSchema: DareInspectToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.inspect(raw),
    }),
    prepare_dare_action: tool({
      description:
        "Prepare a revision-bound confirmation intent for fund, accept, decline, contribute, or cancel. This does not perform the action; the user must confirm the returned single-use intent within ten minutes.",
      inputSchema: DareActionToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.prepareAction(raw),
    }),
    delete_dare_draft: tool({
      description:
        "Delete the requester's own private unfunded draft. Funded or terminal dares cannot be deleted.",
      inputSchema: DareDeleteToolInputSchema,
      outputSchema: DareToolResultSchema,
      execute: (raw) => executors.deleteDraft(raw),
    }),
  };
}
