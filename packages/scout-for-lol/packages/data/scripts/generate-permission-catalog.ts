import { PermissionCatalogSourceSchema } from "#src/model/permissions/permission-catalog-source.ts";

const sourceUrl = new URL("../permission-catalog.json", import.meta.url);
const outputUrl = new URL(
  "../generated/permission-catalog.ts",
  import.meta.url,
);

const catalog = PermissionCatalogSourceSchema.parse(
  await Bun.file(sourceUrl).json(),
);
const output = `// Generated from permission-catalog.json. Do not edit by hand.
export const PERMISSION_CATALOG = ${JSON.stringify(catalog, null, 2)} as const;
`;

await Bun.write(outputUrl, output);
