import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import {
  buildInfo,
  isContractMismatch,
  shortSha,
  VersionResponseSchema,
  type VersionResponse,
} from "#src/lib/build-info.ts";

const DISMISSED_MISMATCH_STORAGE_KEY = "scout:dismissed-contract-mismatch";

function mismatchKey(appContractHash: string, backendContractHash: string) {
  return `${appContractHash}:${backendContractHash}`;
}

async function fetchBackendVersion(): Promise<VersionResponse> {
  const response = await fetch("/api/version", { credentials: "include" });
  if (!response.ok) {
    throw new Error(`GET /api/version failed: ${response.status.toString()}`);
  }
  const body: unknown = await response.json();
  return VersionResponseSchema.parse(body);
}

function useBackendVersion() {
  return useQuery({
    queryKey: ["backend-version"],
    queryFn: fetchBackendVersion,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * Small corner indicator, visible only to the app owner, shown when this
 * bundle and the backend were built against different tRPC contracts (hash
 * comparison — build numbers legitimately differ in a healthy pair). This is
 * a developer diagnostic, not something any other user can act on, so it:
 * - asks the public version endpoint whether this signed session belongs to
 *   the owner; it never invokes the protected `auth.meWeb` identity procedure
 * - stays out of the page flow (fixed corner chip, not a page-pushing
 *   banner)
 * - remembers dismissal per hash pair in localStorage, so it won't nag again
 *   for the same known mismatch, but a *new* mismatch (either side
 *   redeploying to a different hash) un-dismisses it.
 */
export function ContractMismatchBanner() {
  const backend = useBackendVersion();
  const [dismissedKey, setDismissedKey] = useState(() =>
    localStorage.getItem(DISMISSED_MISMATCH_STORAGE_KEY),
  );

  if (backend.data?.canViewContractMismatch !== true) {
    return null;
  }
  if (!isContractMismatch(buildInfo.contractHash, backend.data.contractHash)) {
    return null;
  }
  const key = mismatchKey(buildInfo.contractHash, backend.data.contractHash);
  if (dismissedKey === key) {
    return null;
  }
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-md">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span>
        Version mismatch (app {buildInfo.version}, api {backend.data.version})
      </span>
      <button
        type="button"
        className="font-medium text-foreground underline-offset-2 hover:underline"
        onClick={() => {
          location.reload();
        }}
      >
        Reload
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-sm leading-none text-muted-foreground hover:text-foreground"
        onClick={() => {
          localStorage.setItem(DISMISSED_MISMATCH_STORAGE_KEY, key);
          setDismissedKey(key);
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * One-line build-identity footer: this bundle's version + SHA, and the
 * backend's when reachable. Full contract hashes live in the title attribute
 * for copy/paste during debugging.
 */
export function VersionFooter() {
  const backend = useBackendVersion();

  const appLabel = `app ${buildInfo.version} (${shortSha(buildInfo.gitSha)})`;
  const apiLabel =
    backend.data === undefined
      ? null
      : `api ${backend.data.version} (${shortSha(backend.data.gitSha)})`;
  const title =
    backend.data === undefined
      ? `app contract ${buildInfo.contractHash}`
      : `app contract ${buildInfo.contractHash} · api contract ${backend.data.contractHash}`;

  return (
    <footer className="px-4 py-3 text-center text-xs text-muted-foreground">
      <span title={title}>
        {appLabel}
        {apiLabel === null ? "" : ` · ${apiLabel}`}
      </span>
    </footer>
  );
}
