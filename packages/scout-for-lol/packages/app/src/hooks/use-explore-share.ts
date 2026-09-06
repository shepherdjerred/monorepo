import { useCallback, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  exploreShareLink,
  mintedAfterPersisted,
  resolveShareToken,
} from "#src/lib/explore/explore-share-link.ts";
import { track } from "#src/lib/analytics.ts";
import { useTRPC } from "#src/lib/trpc.ts";

/**
 * TS types `navigator.clipboard` as always present, but insecure origins and
 * some embedded webviews ship without it; the function boundary keeps the
 * declared `| undefined` from being narrowed away at the use site.
 */
function clipboardOrUndefined(): Clipboard | undefined {
  return navigator.clipboard;
}

/**
 * Sharing and revoking the active conversation.
 *
 * The link is derived from the transcript's `shareToken` rather than stored:
 * deleting, revoking, or switching conversations kills it through the query
 * cache, so there is no stale copy to forget to clear. `showShareLink` is the
 * one piece of real state — the link row appears only after an explicit share
 * click on *this* conversation.
 *
 * The token the share mutation just minted is held only until the invalidated
 * query reports it back, because the read-back is a network round trip the user
 * would otherwise wait through with nothing on screen — and one that can fail,
 * stranding a share that succeeded. `explore-share-link.ts` holds both rules;
 * this hook only applies them.
 */
export function useExploreShare(params: {
  conversationId: string | null;
  /** `transcript.data.conversation.shareToken` — the only source of truth. */
  shareToken: string | null;
}): {
  shareLink: string | null;
  showShareLink: boolean;
  copied: boolean;
  sharing: boolean;
  revoking: boolean;
  error: string | null;
  share: () => void;
  revoke: () => void;
} {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [showShareLink, setShowShareLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const shareMutation = useMutation(trpc.explore.share.mutationOptions());
  const revokeMutation = useMutation(
    trpc.explore.revokeShare.mutationOptions(),
  );

  useEffect(() => {
    setShowShareLink(false);
    setCopied(false);
    setError(null);
    setMintedToken(null);
  }, [params.conversationId]);

  // Drop the bridge as soon as the query catches up, so the persisted value is
  // the only thing keeping the link alive from then on.
  useEffect(() => {
    setMintedToken((minted) =>
      mintedAfterPersisted({ minted, persisted: params.shareToken }),
    );
  }, [params.shareToken]);

  const refresh = useCallback(
    async (conversationId: string): Promise<void> => {
      await queryClient.invalidateQueries({
        queryKey: trpc.explore.get.queryKey({ conversationId }),
      });
      await queryClient.invalidateQueries({
        queryKey: trpc.explore.list.queryKey(),
      });
    },
    [queryClient, trpc.explore.get, trpc.explore.list],
  );

  const share = useCallback((): void => {
    const conversationId = params.conversationId;
    if (conversationId === null) {
      return;
    }
    void (async () => {
      setError(null);
      try {
        const result = await shareMutation.mutateAsync({ conversationId });
        // The event deliberately carries nothing: the share token is the
        // credential and must never reach PostHog.
        track("explore_shared");
        const link = `${globalThis.location.origin}/app/explore/s/${result.shareToken}`;
        // Copy before any invalidation round trip: browsers tie clipboard
        // writes to recent user activation, and awaiting refetches first is
        // how a successful share gets reported as a failure. A refused
        // clipboard is not a failed share — the link row says "copy
        // manually" instead. TS types `navigator.clipboard` as always
        // present, but insecure origins and some embedded webviews ship
        // without it, hence the widened read.
        let didCopy = false;
        const clipboard = clipboardOrUndefined();
        if (clipboard !== undefined) {
          try {
            await clipboard.writeText(link);
            didCopy = true;
          } catch {
            didCopy = false;
          }
        }
        setCopied(didCopy);
        setMintedToken(result.shareToken);
        setShowShareLink(true);
        await refresh(conversationId);
      } catch (shareError) {
        setError(
          shareError instanceof Error ? shareError.message : String(shareError),
        );
      }
    })();
  }, [params.conversationId, refresh, shareMutation]);

  const revoke = useCallback((): void => {
    const conversationId = params.conversationId;
    if (conversationId === null) {
      return;
    }
    void (async () => {
      setError(null);
      try {
        await revokeMutation.mutateAsync({ conversationId });
        track("explore_share_revoked");
        setShowShareLink(false);
        setCopied(false);
        setMintedToken(null);
        await refresh(conversationId);
      } catch (revokeError) {
        setError(
          revokeError instanceof Error
            ? revokeError.message
            : String(revokeError),
        );
      }
    })();
  }, [params.conversationId, refresh, revokeMutation]);

  return {
    shareLink: exploreShareLink(
      globalThis.location.origin,
      resolveShareToken({ persisted: params.shareToken, minted: mintedToken }),
    ),
    showShareLink,
    copied,
    sharing: shareMutation.isPending,
    revoking: revokeMutation.isPending,
    error,
    share,
    revoke,
  };
}
