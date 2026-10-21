import type { z } from "zod";
import {
  ArtifactInputSchema,
  PublishBuildSchema,
} from "@shepherdjerred/delivery/contract";
import type { PublishBuild } from "@shepherdjerred/delivery/contract";
import type { Catalog } from "@shepherdjerred/ops-model/catalog.ts";

type Artifact = z.output<typeof PublishBuildSchema>["artifacts"][number];
export type RetainedReference = {
  readonly id: string;
  readonly component: string;
};
/** The exact main pipeline every build of one publication belongs to. */
export type PublicationIdentity = {
  readonly repositoryId: number;
  readonly pipelineNumber: number;
  readonly sourceRevision: string;
  readonly ciUrl: string;
  readonly capturedAt: string;
};

/** Fresh artifacts and retained references per service, with the one-component-one-artifact rule. */
export class PublicationLedger {
  readonly #publications = new Map<string, Artifact[]>();
  readonly #retained = new Map<string, RetainedReference[]>();
  readonly #catalog: Catalog;
  readonly #alsoOwns: (serviceId: string) => boolean;

  constructor(
    catalog: Catalog,
    alsoOwns: (serviceId: string) => boolean = () => false,
  ) {
    this.#catalog = catalog;
    this.#alsoOwns = alsoOwns;
  }

  add(serviceId: string, rawArtifact: z.input<typeof ArtifactInputSchema>) {
    const artifact = ArtifactInputSchema.parse(rawArtifact);
    if (
      (this.#retained.get(serviceId) ?? []).some(
        (entry) => entry.component === artifact.component,
      )
    )
      throw new Error(
        "A publication cannot replace and retain the same component",
      );
    const entries = this.#publications.get(serviceId) ?? [];
    const existing = entries.find(
      (entry) => entry.component === artifact.component,
    );
    if (existing !== undefined) {
      if (existing.digest !== artifact.digest)
        throw new Error(
          `One CI pipeline published conflicting versions of ${artifact.component}`,
        );
      return;
    }
    entries.push(artifact);
    this.#publications.set(serviceId, entries);
  }

  retain(serviceId: string, reference: RetainedReference) {
    if (
      !this.#catalog.services.some((service) => service.id === serviceId) &&
      !this.#alsoOwns(serviceId)
    )
      throw new Error("Retained artifact requires a canonical service owner");
    if (
      (this.#publications.get(serviceId) ?? []).some(
        (entry) => entry.component === reference.component,
      )
    )
      throw new Error(
        "A publication cannot replace and retain the same component",
      );
    const references = this.#retained.get(serviceId) ?? [];
    if (
      references.some(
        (entry) =>
          entry.component === reference.component && entry.id !== reference.id,
      )
    )
      throw new Error(
        "A publication cannot retain conflicting artifacts for one component",
      );
    if (!references.some((entry) => entry.id === reference.id))
      references.push(reference);
    this.#retained.set(serviceId, references);
    if (!this.#publications.has(serviceId))
      this.#publications.set(serviceId, []);
  }

  builds(input: PublicationIdentity): PublishBuild[] {
    return [...this.#publications].map(([serviceId, artifacts]) =>
      PublishBuildSchema.parse({
        requestId: `ci/${String(input.repositoryId)}/${String(input.pipelineNumber)}/${serviceId}`,
        serviceId,
        sourceRevision: input.sourceRevision,
        ciUrl: input.ciUrl,
        verifiedAt: input.capturedAt,
        artifacts,
        retainedArtifactIds: (this.#retained.get(serviceId) ?? []).map(
          (entry) => entry.id,
        ),
      }),
    );
  }
}
