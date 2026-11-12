import { Construct } from "constructs";
import { TerraformDataSource } from "cdktn";
import type { TerraformResource, TerraformStack } from "cdktn";
import { moved } from "#src/state-migrations.ts";

/** One object a flattened module declared, at its old and new address. */
export type Relocation = {
  /** `module.<call>[…].<type>.<name>[…]`, as state held it. */
  from: string;
  /** The root address the construct gives it. */
  to: string;
  /**
   * A data source is read again at its new address: state holds nothing a
   * `moved` block could relocate, and OpenTofu accepts none for it.
   */
  dataSource: boolean;
};

/**
 * A construct that replaces a local HCL module (pass two of a port; see the
 * README). Every resource the module declared is created through
 * {@link FlattenedModule.place}, which names it at the root and records the
 * module address it had, so the `moved` blocks are written from the same
 * calls that create the resources and none can be forgotten.
 */
export abstract class FlattenedModule extends Construct {
  private readonly placed: Relocation[] = [];

  /** @param moduleAddress the module instance: `module.<call>` or `module.<call>["<key>"]`. */
  protected constructor(
    scope: Construct,
    id: string,
    private readonly moduleAddress: string,
  ) {
    super(scope, id);
  }

  /**
   * Gives `resource` the root name `name` and records that it was
   * `<name in module>` (with any `for_each` key or `count` index) inside the
   * module instance.
   */
  protected place<Element extends TerraformResource | TerraformDataSource>(
    resource: Element,
    name: string,
    nameInModule: string,
  ): Element {
    resource.overrideLogicalId(name);
    const dataSource = resource instanceof TerraformDataSource;
    const kind = `${dataSource ? "data." : ""}${resource.terraformResourceType}`;
    this.placed.push({
      from: `${this.moduleAddress}.${kind}.${nameInModule}`,
      to: `${kind}.${name}`,
      dataSource,
    });
    return resource;
  }

  /** Every object of the module instance, in creation order. */
  get relocations(): readonly Relocation[] {
    return this.placed;
  }

  /** Writes one `moved` block per managed resource of the module instance. */
  moveIntoRoot(stack: TerraformStack): void {
    for (const { from, to, dataSource } of this.placed)
      if (!dataSource) moved(stack, from, to);
  }
}
