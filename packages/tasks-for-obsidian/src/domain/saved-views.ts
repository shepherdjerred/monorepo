import { z } from "zod";

import { PrioritySchema, TaskStatusSchema } from "./base-schemas";

export const SAVED_VIEW_PREFERENCES_VERSION = 1;

const SavedViewIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use a lowercase kebab-case ID");

const SavedViewNameSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(
    (name) => name.trim() === name,
    "Name must not have outer whitespace",
  );

const QueryValueSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.trim() === value,
    "Query values must not have outer whitespace",
  );

export const RelativeDayRangeSchema = z
  .strictObject({
    startOffsetDays: z.number().int().optional(),
    endOffsetDays: z.number().int().optional(),
  })
  .superRefine((range, context) => {
    if (
      range.startOffsetDays === undefined &&
      range.endOffsetDays === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "A relative day range needs at least one bound",
      });
    }

    if (
      range.startOffsetDays !== undefined &&
      range.endOffsetDays !== undefined &&
      range.startOffsetDays > range.endOffsetDays
    ) {
      context.addIssue({
        code: "custom",
        message: "The start offset must not be after the end offset",
        path: ["endOffsetDays"],
      });
    }
  });

export type RelativeDayRange = z.infer<typeof RelativeDayRangeSchema>;

export const MissingTaskFieldSchema = z.enum([
  "project",
  "context",
  "tag",
  "scheduled",
  "deadline",
  "recurrence",
  "estimate",
]);

export const SavedViewCompletionQuerySchema = z.enum([
  "active",
  "completed",
  "all",
]);

export const SavedViewQuerySchema = z.strictObject({
  projects: z.array(QueryValueSchema),
  contexts: z.array(QueryValueSchema),
  tags: z.array(QueryValueSchema),
  statuses: z.array(TaskStatusSchema),
  priorities: z.array(PrioritySchema),
  text: QueryValueSchema.max(500).optional(),
  completed: SavedViewCompletionQuerySchema,
  missingFields: z.array(MissingTaskFieldSchema),
  scheduled: RelativeDayRangeSchema.optional(),
  deadline: RelativeDayRangeSchema.optional(),
});

export type SavedViewQuery = z.infer<typeof SavedViewQuerySchema>;

export const SavedViewSortSchema = z.strictObject({
  field: z.enum([
    "scheduled",
    "deadline",
    "priority",
    "title",
    "created",
    "completed",
  ]),
  direction: z.enum(["ascending", "descending"]),
});

export const SavedViewGroupSchema = z.enum([
  "none",
  "scheduled",
  "deadline",
  "project",
  "context",
  "tag",
  "status",
  "priority",
]);

export const SavedViewPresentationSchema = z.strictObject({
  layout: z.literal("list"),
  sort: SavedViewSortSchema,
  group: SavedViewGroupSchema,
});

export type SavedViewPresentation = z.infer<typeof SavedViewPresentationSchema>;

export const SavedViewSchema = z.strictObject({
  id: SavedViewIdSchema,
  name: SavedViewNameSchema,
  symbol: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, "Use a valid SF Symbol identifier"),
  tint: z.string().regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hexadecimal tint"),
  favorite: z.boolean(),
  order: z.number().int().nonnegative(),
  query: SavedViewQuerySchema,
  presentation: SavedViewPresentationSchema,
});

export type SavedView = z.infer<typeof SavedViewSchema>;

export const SavedViewPreferencesSchema = z
  .strictObject({
    version: z.literal(SAVED_VIEW_PREFERENCES_VERSION),
    views: z.array(SavedViewSchema),
  })
  .superRefine((preferences, context) => {
    const ids = new Set<string>();
    const orders = new Set<number>();

    preferences.views.forEach((view, index) => {
      if (ids.has(view.id)) {
        context.addIssue({
          code: "custom",
          message: `Saved view ID ${view.id} is duplicated`,
          path: ["views", index, "id"],
        });
      }
      ids.add(view.id);

      if (orders.has(view.order)) {
        context.addIssue({
          code: "custom",
          message: `Saved view order ${String(view.order)} is duplicated`,
          path: ["views", index, "order"],
        });
      }
      orders.add(view.order);
    });
  });

export type SavedViewPreferences = z.infer<typeof SavedViewPreferencesSchema>;

const JOB_SEARCH_VIEW = SavedViewSchema.parse({
  id: "job-search",
  name: "Job Search",
  symbol: "briefcase",
  tint: "#6366f1",
  favorite: true,
  order: 0,
  query: {
    projects: ["[[2026 Job Search]]"],
    contexts: [],
    tags: [],
    statuses: [],
    priorities: [],
    completed: "active",
    missingFields: [],
  },
  presentation: {
    layout: "list",
    sort: { field: "deadline", direction: "ascending" },
    group: "none",
  },
});

const SCHOOL_VIEW = SavedViewSchema.parse({
  id: "school",
  name: "School",
  symbol: "book.closed",
  tint: "#22c55e",
  favorite: true,
  order: 1,
  query: {
    projects: [],
    contexts: ["school"],
    tags: [],
    statuses: [],
    priorities: [],
    completed: "active",
    missingFields: [],
  },
  presentation: {
    layout: "list",
    sort: { field: "deadline", direction: "ascending" },
    group: "none",
  },
});

export function createDefaultSavedViewPreferences(): SavedViewPreferences {
  return SavedViewPreferencesSchema.parse({
    version: SAVED_VIEW_PREFERENCES_VERSION,
    views: [JOB_SEARCH_VIEW, SCHOOL_VIEW],
  });
}

/**
 * Transitional projection for the existing Browse UI. New code should load
 * editable views through SavedViewRepository instead of this constant.
 */
export const DEFAULT_SAVED_VIEWS = [
  {
    id: JOB_SEARCH_VIEW.id,
    name: JOB_SEARCH_VIEW.name,
    icon: "briefcase",
    filter: JOB_SEARCH_VIEW.query,
    color: JOB_SEARCH_VIEW.tint,
  },
  {
    id: SCHOOL_VIEW.id,
    name: SCHOOL_VIEW.name,
    icon: "book-open",
    filter: SCHOOL_VIEW.query,
    color: SCHOOL_VIEW.tint,
  },
] as const;

const LegacySavedViewSchema = z.strictObject({
  id: SavedViewIdSchema,
  name: SavedViewNameSchema,
  icon: z.enum(["briefcase", "book-open"]),
  filter: z.strictObject({
    projects: z.array(QueryValueSchema).optional(),
    contexts: z.array(QueryValueSchema).optional(),
    tags: z.array(QueryValueSchema).optional(),
    statuses: z.array(TaskStatusSchema).optional(),
    priorities: z.array(PrioritySchema).optional(),
    hasNoDueDate: z.boolean().optional(),
  }),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hexadecimal tint"),
});

const LegacySavedViewPreferencesSchema = z.strictObject({
  version: z.literal(0),
  views: z.array(LegacySavedViewSchema),
});

type LegacySavedView = z.infer<typeof LegacySavedViewSchema>;

function migrateLegacySymbol(icon: LegacySavedView["icon"]): string {
  switch (icon) {
    case "briefcase":
      return "briefcase";
    case "book-open":
      return "book.closed";
  }
}

function migrateLegacySavedViewPreferences(
  value: unknown,
): SavedViewPreferences {
  const legacy = LegacySavedViewPreferencesSchema.parse(value);

  return SavedViewPreferencesSchema.parse({
    version: SAVED_VIEW_PREFERENCES_VERSION,
    views: legacy.views.map((view, order) => ({
      id: view.id,
      name: view.name,
      symbol: migrateLegacySymbol(view.icon),
      tint: view.color,
      favorite: true,
      order,
      query: {
        projects: view.filter.projects ?? [],
        contexts: view.filter.contexts ?? [],
        tags: view.filter.tags ?? [],
        statuses: view.filter.statuses ?? [],
        priorities: view.filter.priorities ?? [],
        completed: "active",
        missingFields: view.filter.hasNoDueDate === true ? ["deadline"] : [],
      },
      presentation: {
        layout: "list",
        sort: { field: "deadline", direction: "ascending" },
        group: "none",
      },
    })),
  });
}

export class UnsupportedSavedViewPreferencesVersionError extends Error {
  public constructor(public readonly version: number) {
    super(`Unsupported saved-view preferences version: ${String(version)}`);
    this.name = "UnsupportedSavedViewPreferencesVersionError";
  }
}

export type DecodedSavedViewPreferences = {
  readonly preferences: SavedViewPreferences;
  readonly migrated: boolean;
};

const SavedViewPreferencesVersionSchema = z.object({
  version: z.number().int().nonnegative(),
});

export function decodeSavedViewPreferences(
  raw: string,
): DecodedSavedViewPreferences {
  const value: unknown = JSON.parse(raw);
  const { version } = SavedViewPreferencesVersionSchema.parse(value);

  switch (version) {
    case 0:
      return {
        preferences: migrateLegacySavedViewPreferences(value),
        migrated: true,
      };
    case SAVED_VIEW_PREFERENCES_VERSION:
      return {
        preferences: SavedViewPreferencesSchema.parse(value),
        migrated: false,
      };
    default:
      throw new UnsupportedSavedViewPreferencesVersionError(version);
  }
}

export function encodeSavedViewPreferences(value: unknown): string {
  return JSON.stringify(SavedViewPreferencesSchema.parse(value));
}
