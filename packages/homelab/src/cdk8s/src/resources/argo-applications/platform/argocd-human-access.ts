/**
 * Human access to ArgoCD after the Delivery v2 cutover (model section 8):
 * people read Applications, and only Delivery's account changes or syncs them.
 *
 * On since the window's lock-down step, which followed acceptance; the
 * operator-run bootstrap and account tools used the built-in `admin` account
 * until then. On, `admin` is disabled and the human `operator` login holds
 * ArgoCD's built-in read-only role. ArgoCD reads that login's password only
 * from `argocd-secret`, so it is provisioned and verified there before this
 * turns on: `/how-to/set-the-argocd-operator-password/`. The break-glass is
 * the wiki how-to `/how-to/regain-write-access-to-argocd/`.
 */
export function humanArgoCdReadOnly(): boolean {
  return true;
}

/** The local login account people use once ArgoCD is read-only for them. */
export const HUMAN_ARGOCD_ACCOUNT = "operator";

/**
 * The API-only account agent workstations use through toolkit. It cannot log
 * in and holds the same read-only role as the human login. The `argocd`
 * OpenTofu stack mints its token into an item workstations read.
 */
export const WORKSTATION_ARGOCD_ACCOUNT = "workstation";

/**
 * The API-only account the Temporal homelab audit uses through
 * `toolkit argocd`. It is read-only like the workstation account but a
 * separate identity, so ArgoCD's logs and token rotation tell them apart.
 */
export const HOMELAB_AUDIT_ARGOCD_ACCOUNT = "homelab-audit";

/** `argocd-cm` settings for human access; nothing changes while it is off. */
export function humanArgoCdSettings(
  readOnly: boolean = humanArgoCdReadOnly(),
): Record<string, string | boolean> {
  return readOnly
    ? {
        "admin.enabled": false,
        [`accounts.${HUMAN_ARGOCD_ACCOUNT}`]: "login",
        [`accounts.${HUMAN_ARGOCD_ACCOUNT}.enabled`]: true,
        [`accounts.${WORKSTATION_ARGOCD_ACCOUNT}`]: "apiKey",
        [`accounts.${WORKSTATION_ARGOCD_ACCOUNT}.enabled`]: true,
        [`accounts.${HOMELAB_AUDIT_ARGOCD_ACCOUNT}`]: "apiKey",
        [`accounts.${HOMELAB_AUDIT_ARGOCD_ACCOUNT}.enabled`]: true,
      }
    : {};
}

/** `argocd-rbac-cm` rows for human access, appended to the Delivery grants. */
export function humanArgoCdPolicyRows(
  readOnly: boolean = humanArgoCdReadOnly(),
): string[] {
  return readOnly
    ? [
        `g, ${HUMAN_ARGOCD_ACCOUNT}, role:readonly`,
        `g, ${WORKSTATION_ARGOCD_ACCOUNT}, role:readonly`,
        `g, ${HOMELAB_AUDIT_ARGOCD_ACCOUNT}, role:readonly`,
      ]
    : [];
}
