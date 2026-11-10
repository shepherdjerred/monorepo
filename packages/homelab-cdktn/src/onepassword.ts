import type { Construct } from "constructs";
import type { ITerraformIterator, TerraformResource } from "cdktn";
import { Item } from "#generated/providers/onepassword/item/index.ts";

/**
 * The "Homelab (Kubernetes)" vault, which the cluster's 1Password operator
 * syncs. Every stack that hands a credential to a workload writes here.
 */
export const HOMELAB_VAULT_ID = "v64ocnykdqju4ui6j6pua56xw4";

export type OnePasswordWriteOptions = {
  /** Item title: a literal, or an iterator value such as `each.getString("title")`. */
  readonly title: string;
  /** Label of the one section holding the fields. */
  readonly section: string;
  /**
   * Concealed fields by label, in declaration order. The values are
   * references to the resources that mint them, never literals.
   */
  readonly fields: Readonly<Record<string, string>>;
  /** Item category; omitted, the provider's default (`login`) applies. */
  readonly category?: string;
  /** One item per element, as `for_each` on the HCL resource. */
  readonly forEach?: ITerraformIterator;
  /** Resources the item must wait for beyond those its fields reference. */
  readonly dependsOn?: TerraformResource[];
};

/**
 * A `onepassword_item` holding concealed fields in one section: the way a
 * stack hands a credential it minted to the workload that consumes it.
 *
 * The item is created in `scope` with `id` as its resource name, so
 * `onePasswordWrite(this, "argocd_delivery_token", …)` is
 * `onepassword_item.argocd_delivery_token`, the address the HCL stack has.
 */
export function onePasswordWrite(
  scope: Construct,
  id: string,
  options: OnePasswordWriteOptions,
): Item {
  const fields = Object.entries(options.fields);
  if (fields.length === 0)
    throw new Error(`1Password item ${id} declares no fields`);
  return new Item(scope, id, {
    vault: HOMELAB_VAULT_ID,
    title: options.title,
    ...(options.category === undefined ? {} : { category: options.category }),
    section: [
      {
        label: options.section,
        field: fields.map(([label, value]) => ({
          label,
          type: "CONCEALED",
          value,
        })),
      },
    ],
    ...(options.forEach === undefined ? {} : { forEach: options.forEach }),
    ...(options.dependsOn === undefined
      ? {}
      : { dependsOn: options.dependsOn }),
  });
}
