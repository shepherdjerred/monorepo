export function branchName(identifier: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return `agent/${identifier.toLowerCase()}-${slug || "task"}`;
}
