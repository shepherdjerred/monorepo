import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import {
  AdminCard,
  SubmitButton,
  TextField,
} from "#src/components/admin-form-controls.tsx";

type Props = {
  guildId: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

export function PlayerAdminForms(props: Props) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [renameCurrentAlias, setRenameCurrentAlias] = useState("");
  const [renameNewAlias, setRenameNewAlias] = useState("");
  const [mergeSourceAlias, setMergeSourceAlias] = useState("");
  const [mergeTargetAlias, setMergeTargetAlias] = useState("");
  const [deleteAlias, setDeleteAlias] = useState("");
  const [linkAlias, setLinkAlias] = useState("");
  const [linkDiscordId, setLinkDiscordId] = useState("");
  const [unlinkAlias, setUnlinkAlias] = useState("");

  function requireValue(value: string, label: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      props.onError(`${label} is required.`);
      return null;
    }
    return trimmed;
  }

  const renameMutation = useMutation(
    trpc.player.renamePlayer.mutationOptions({
      onSuccess: (result) => {
        props.onSuccess("Player renamed.");
        void navigate(
          `/g/${props.guildId}/players/${encodeURIComponent(result.alias)}`,
        );
      },
      onError: (err) => {
        props.onError(err.message);
      },
    }),
  );
  const deletePlayerMutation = useMutation(
    trpc.player.deletePlayer.mutationOptions({
      onSuccess: (result) => {
        props.onSuccess(`Deleted "${result.deletedAlias}".`);
        void navigate(`/g/${props.guildId}/players`);
      },
      onError: (err) => {
        props.onError(err.message);
      },
    }),
  );
  const mergeMutation = useMutation(
    trpc.player.mergePlayers.mutationOptions({
      onSuccess: (result) => {
        props.onSuccess("Players merged.");
        void navigate(
          `/g/${props.guildId}/players/${encodeURIComponent(result.targetAlias)}`,
        );
      },
      onError: (err) => {
        props.onError(err.message);
      },
    }),
  );
  const linkMutation = useMutation(
    trpc.player.linkDiscord.mutationOptions({
      onSuccess: (result) => {
        props.onSuccess("Discord user linked.");
        void navigate(
          `/g/${props.guildId}/players/${encodeURIComponent(result.alias)}`,
        );
      },
      onError: (err) => {
        props.onError(err.message);
      },
    }),
  );
  const unlinkMutation = useMutation(
    trpc.player.unlinkDiscord.mutationOptions({
      onSuccess: (result) => {
        props.onSuccess("Discord user unlinked.");
        void navigate(
          `/g/${props.guildId}/players/${encodeURIComponent(result.alias)}`,
        );
      },
      onError: (err) => {
        props.onError(err.message);
      },
    }),
  );

  return (
    <>
      <AdminCard title="Rename player">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const currentAlias = requireValue(
              renameCurrentAlias,
              "Current alias",
            );
            const newAlias = requireValue(renameNewAlias, "New alias");
            if (currentAlias === null || newAlias === null) return;
            renameMutation.mutate({
              guildId: props.guildId,
              currentAlias,
              newAlias,
            });
          }}
        >
          <TextField
            id="rename-current"
            label="Current alias"
            value={renameCurrentAlias}
            onChange={setRenameCurrentAlias}
          />
          <TextField
            id="rename-new"
            label="New alias"
            value={renameNewAlias}
            onChange={setRenameNewAlias}
          />
          <SubmitButton pending={renameMutation.isPending} label="Rename" />
        </form>
      </AdminCard>

      <AdminCard title="Merge players">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const sourceAlias = requireValue(mergeSourceAlias, "Source alias");
            const targetAlias = requireValue(mergeTargetAlias, "Target alias");
            if (sourceAlias === null || targetAlias === null) return;
            if (
              !globalThis.confirm(
                `Merge "${sourceAlias}" into "${targetAlias}"? This deletes the source player.`,
              )
            ) {
              return;
            }
            mergeMutation.mutate({
              guildId: props.guildId,
              sourceAlias,
              targetAlias,
            });
          }}
        >
          <TextField
            id="merge-source"
            label="Source alias"
            value={mergeSourceAlias}
            onChange={setMergeSourceAlias}
          />
          <TextField
            id="merge-target"
            label="Target alias"
            value={mergeTargetAlias}
            onChange={setMergeTargetAlias}
          />
          <SubmitButton pending={mergeMutation.isPending} label="Merge" />
        </form>
      </AdminCard>

      <AdminCard title="Delete player">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const alias = requireValue(deleteAlias, "Alias");
            if (alias === null) return;
            if (!globalThis.confirm(`Delete "${alias}" and all linked data?`)) {
              return;
            }
            deletePlayerMutation.mutate({ guildId: props.guildId, alias });
          }}
        >
          <TextField
            id="delete-player"
            label="Alias"
            value={deleteAlias}
            onChange={setDeleteAlias}
          />
          <SubmitButton
            pending={deletePlayerMutation.isPending}
            label="Delete"
            variant="destructive"
          />
        </form>
      </AdminCard>

      <AdminCard title="Link Discord">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const playerAlias = requireValue(linkAlias, "Alias");
            const discordUserId = requireValue(
              linkDiscordId,
              "Discord user ID",
            );
            if (playerAlias === null || discordUserId === null) return;
            linkMutation.mutate({
              guildId: props.guildId,
              playerAlias,
              discordUserId,
            });
          }}
        >
          <TextField
            id="link-alias"
            label="Alias"
            value={linkAlias}
            onChange={setLinkAlias}
          />
          <TextField
            id="link-discord"
            label="Discord user ID"
            value={linkDiscordId}
            onChange={setLinkDiscordId}
          />
          <SubmitButton pending={linkMutation.isPending} label="Link" />
        </form>
      </AdminCard>

      <AdminCard title="Unlink Discord">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const playerAlias = requireValue(unlinkAlias, "Alias");
            if (playerAlias === null) return;
            unlinkMutation.mutate({ guildId: props.guildId, playerAlias });
          }}
        >
          <TextField
            id="unlink-alias"
            label="Alias"
            value={unlinkAlias}
            onChange={setUnlinkAlias}
          />
          <SubmitButton pending={unlinkMutation.isPending} label="Unlink" />
        </form>
      </AdminCard>
    </>
  );
}
