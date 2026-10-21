/** Per-resource ArgoCD sync options (`argocd.argoproj.io/sync-options`). */
export const ARGOCD_SYNC_OPTIONS_ANNOTATION = "argocd.argoproj.io/sync-options";

/**
 * A resource that outlives any one Application: neither an automated prune
 * nor a cascading Application delete may remove it. The data-layer charts'
 * Namespaces and PostgreSQL clusters carry this, so deleting or re-pointing
 * any Application can never take a database with it.
 */
export const RETAINED_RESOURCE_SYNC_OPTIONS = "Prune=false,Delete=false";

export function retainedResourceAnnotations(): Record<string, string> {
  return { [ARGOCD_SYNC_OPTIONS_ANNOTATION]: RETAINED_RESOURCE_SYNC_OPTIONS };
}
