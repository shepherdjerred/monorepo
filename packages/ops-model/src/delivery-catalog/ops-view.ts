import {
  type Catalog,
  parseCatalog,
} from "@shepherdjerred/ops-model/catalog.ts";
import { componentType } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import type { CatalogCore } from "./core.ts";

/**
 * The services.json-shaped ops view derived from the catalog document. Each
 * group becomes one ops service; its lists concatenate its member services'
 * `ops` and `legacy` attributes in catalog order, and its images are the
 * members' first-party image components. Acquired and referenced images
 * belong to another producer, so the ops view never claims them.
 *
 * Until the window retires `services.json`, the ops consumers read that file;
 * `service-catalog-view.test.ts` proves this view equals it, so moving them to
 * the view changes no byte they render.
 */
export function serviceCatalogView(core: CatalogCore): Catalog {
  const services = core.groups.map((group) => {
    const members = core.services.filter(
      (service) => service.group === group.id,
    );
    const list = (
      pick: (member: (typeof members)[number]) => readonly string[],
    ): string[] => members.flatMap((member) => pick(member));
    const exclusions = Object.fromEntries(
      members.flatMap((member) =>
        Object.entries(member.legacy?.rootReleaseExclusions ?? {}),
      ),
    );
    return {
      id: group.id,
      title: group.title,
      kind: group.kind,
      ...(group.package === undefined ? {} : { package: group.package }),
      aliases: [
        ...group.aliases,
        ...list((member) => member.ops?.aliases ?? []),
      ],
      namespaces: list((member) => member.ops?.namespaces ?? []),
      argoApps: list((member) => member.ops?.argoApps ?? []),
      charts: list((member) => member.legacy?.charts ?? []),
      ...(Object.keys(exclusions).length === 0
        ? {}
        : { rootReleaseExclusions: exclusions }),
      images: list((member) =>
        member.components
          .filter(
            (component) =>
              component.producer === "first-party" &&
              componentType(component.name) === "image",
          )
          .map((component) => component.name.slice("image:".length)),
      ),
      bootstrapImages: list((member) => member.legacy?.bootstrapImages ?? []),
      bugsinkProjects: list((member) => member.ops?.bugsinkProjects ?? []),
      analyticsSites: list((member) => member.ops?.analyticsSites ?? []),
      grafanaDashboards: list((member) => member.ops?.grafanaDashboards ?? []),
      deploy: members.flatMap((member) => member.legacy?.deploy ?? []),
    };
  });
  return parseCatalog({
    ...(core.legacy?.deliveryDelegations === undefined
      ? {}
      : { deliveryDelegations: core.legacy.deliveryDelegations }),
    ...(core.legacy?.platformDeliveryDelegated === undefined
      ? {}
      : { platformDeliveryDelegated: core.legacy.platformDeliveryDelegated }),
    services,
  });
}
