import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ExploreConversation } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { ExploreSidebar } from "#src/components/explore/explore-sidebar.tsx";
import { useOptionalExploreRuns } from "#src/components/explore/explore-runs-context.ts";
import { RenameConversationDialog } from "#src/components/dialogs/rename-conversation-dialog.tsx";
import { ConfirmDeleteDialog } from "#src/components/dialogs/confirm-delete-dialog.tsx";
import { analyticsMeta } from "#src/lib/analytics.ts";

export function ExploreNavigationSection(props: { activeId: string | null }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runs = useOptionalExploreRuns();
  const [renaming, setRenaming] = useState<ExploreConversation | null>(null);
  const [deleting, setDeleting] = useState<ExploreConversation | null>(null);

  const conversationsQuery = useQuery({
    ...trpc.explore.list.queryOptions(),
    staleTime: 60_000,
  });

  const renameMutation = useMutation(
    trpc.explore.rename.mutationOptions({
      meta: analyticsMeta("explore_conversation_renamed"),
    }),
  );
  const deleteMutation = useMutation(
    trpc.explore.delete.mutationOptions({
      meta: analyticsMeta("explore_conversation_deleted"),
    }),
  );

  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleSelect = (id: string) => {
    void navigate(`/explore/${id}`);
  };

  const handleNew = () => {
    void navigate("/explore");
  };

  const handleStartRename = (conversation: ExploreConversation) => {
    setRenameError(null);
    setRenaming(conversation);
  };

  const handleStartDelete = (conversation: ExploreConversation) => {
    setDeleteError(null);
    setDeleting(conversation);
  };

  const handleRename = (
    conversation: ExploreConversation,
    nextTitle: string,
  ) => {
    setRenameError(null);
    renameMutation.mutate(
      {
        conversationId: conversation.id,
        title: nextTitle,
      },
      {
        onSuccess: () => {
          setRenaming(null);
          void Promise.all([
            queryClient.invalidateQueries({
              queryKey: trpc.explore.list.queryKey(),
            }),
            queryClient.invalidateQueries({
              queryKey: trpc.explore.get.queryKey({
                conversationId: conversation.id,
              }),
            }),
          ]);
        },
        onError: (err: unknown) => {
          setRenameError(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  const handleDelete = (conversation: ExploreConversation) => {
    setDeleteError(null);
    deleteMutation.mutate(
      { conversationId: conversation.id },
      {
        onSuccess: () => {
          setDeleting(null);
          queryClient.removeQueries({
            queryKey: trpc.explore.get.queryKey({
              conversationId: conversation.id,
            }),
          });
          void queryClient.invalidateQueries({
            queryKey: trpc.explore.list.queryKey(),
          });
          if (props.activeId === conversation.id) {
            void navigate("/explore", { replace: true });
          }
        },
        onError: (err: unknown) => {
          setDeleteError(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  const statusForConversation = runs?.status ?? (() => null);

  return (
    <>
      <ExploreSidebar
        conversations={conversationsQuery.data ?? []}
        activeId={props.activeId}
        onSelect={handleSelect}
        onNew={handleNew}
        onRename={handleStartRename}
        onDelete={handleStartDelete}
        statusForConversation={statusForConversation}
        showNewButton={false}
      />

      <RenameConversationDialog
        conversation={renaming}
        pending={renameMutation.isPending}
        error={renameError}
        onClose={() => {
          setRenaming(null);
          setRenameError(null);
        }}
        onRename={(conversation, nextTitle) => {
          handleRename(conversation, nextTitle);
        }}
      />

      <ConfirmDeleteDialog
        conversation={deleting}
        pending={deleteMutation.isPending}
        error={deleteError}
        onClose={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        onConfirm={(conversation) => {
          handleDelete(conversation);
        }}
      />
    </>
  );
}
