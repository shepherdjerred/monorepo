import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Button } from "#src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import {
  buildInfo,
  isContractMismatch,
  shortSha,
  VersionResponseSchema,
  type VersionResponse,
} from "#src/lib/build-info.ts";

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
 * Full-width banner shown when this bundle and the backend were built
 * against different tRPC contracts (hash comparison — build numbers
 * legitimately differ in a healthy pair). Reloading fetches the bundle that
 * matches the running backend.
 */
export function ContractMismatchBanner() {
  const [dismissed, setDismissed] = useState(false);
  const backend = useBackendVersion();

  if (dismissed || backend.data === undefined) {
    return null;
  }
  if (!isContractMismatch(buildInfo.contractHash, backend.data.contractHash)) {
    return null;
  }
  return (
    <div className="mx-auto max-w-2xl px-4 pt-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-4 w-4" />A new version of Scout is
            available
          </CardTitle>
          <CardDescription>
            This page was built against a different API version (app{" "}
            {buildInfo.version}, api {backend.data.version}). Reload to get the
            matching version.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2 pt-0">
          <Button
            size="sm"
            onClick={() => {
              location.reload();
            }}
          >
            Reload
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDismissed(true);
            }}
          >
            Dismiss
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One-line build-identity footer: this bundle's version + SHA, and the
 * backend's when reachable. Full contract hashes live in the title attribute
 * for copy/paste during debugging.
 */
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

/**
 * Short SHA linked to the commit on GitHub when the build carries a real
 * 40-char SHA; dev builds carry placeholders and render as plain text.
 */
function CommitSha(props: { gitSha: string }) {
  if (!FULL_SHA_PATTERN.test(props.gitSha)) {
    return <>{shortSha(props.gitSha)}</>;
  }
  return (
    <a
      href={`https://github.com/shepherdjerred/monorepo/commit/${props.gitSha}`}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      {shortSha(props.gitSha)}
    </a>
  );
}

export function VersionFooter() {
  const backend = useBackendVersion();

  const title =
    backend.data === undefined
      ? `app contract ${buildInfo.contractHash}`
      : `app contract ${buildInfo.contractHash} · api contract ${backend.data.contractHash}`;

  return (
    <footer className="px-4 py-3 text-center text-xs text-muted-foreground">
      <span title={title}>
        app {buildInfo.version} (<CommitSha gitSha={buildInfo.gitSha} />)
        {backend.data === undefined ? null : (
          <>
            {" · "}api {backend.data.version} (
            <CommitSha gitSha={backend.data.gitSha} />)
          </>
        )}
      </span>
    </footer>
  );
}
