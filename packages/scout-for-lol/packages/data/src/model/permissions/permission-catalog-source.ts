import { z } from "zod";

const CatalogNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/);

const PermissionActionSourceSchema = z.strictObject({
  name: CatalogNameSchema,
  label: z.string().min(1),
  description: z.string().min(1).optional(),
});

const PermissionResourceSourceSchema = z
  .strictObject({
    label: z.string().min(1),
    description: z.string().min(1).optional(),
    actions: z.array(PermissionActionSourceSchema).min(1),
  })
  .superRefine((resource, context) => {
    const names = new Set<string>();
    for (const action of resource.actions) {
      if (names.has(action.name)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate action name: ${action.name}`,
          path: ["actions"],
        });
      }
      names.add(action.name);
    }
  });

/** TypeScript-side validation for the language-neutral JSON catalog. */
export const PermissionCatalogSourceSchema = z.record(
  CatalogNameSchema,
  PermissionResourceSourceSchema,
);
