import type { ApiObject } from "cdk8s";
import {
  ARGOCD_SYNC_OPTIONS_ANNOTATION,
  RETAINED_RESOURCE_SYNC_OPTIONS,
} from "@shepherdjerred/homelab/cdk8s/src/misc/argocd-sync-options.ts";

/**
 * A data-layer chart's PostgreSQL cluster keeps the constructors' `Delete=false`
 * and additionally refuses automated pruning: the only way to remove the
 * cluster is a deliberate, human-run delete, never a sync whose desired state
 * happens to omit it.
 */
export function retainDataLayerResource(resource: ApiObject): void {
  resource.metadata.addAnnotation(
    ARGOCD_SYNC_OPTIONS_ANNOTATION,
    RETAINED_RESOURCE_SYNC_OPTIONS,
  );
}
