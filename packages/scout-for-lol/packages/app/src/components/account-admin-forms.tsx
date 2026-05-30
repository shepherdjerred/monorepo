import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { RiotIdSchema } from "@scout-for-lol/data";
import { useTRPC } from "#src/lib/trpc.ts";
import type { RegionValue } from "#src/lib/regions.ts";
import {
  AdminCard,
  RiotAccountFields,
  SubmitButton,
  TextField,
} from "#src/components/admin-form-controls.tsx";

type Props = {
  guildId: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
};

export function AccountAdminForms(props: Props) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [addAccountAlias, setAddAccountAlias] = useState("");
  const [addAccountRiotId, setAddAccountRiotId] = useState("");
  const [addAccountRegion, setAddAccountRegion] =
    useState<RegionValue>("AMERICA_NORTH");
  const [deleteAccountRiotId, setDeleteAccountRiotId] = useState("");
  const [deleteAccountRegion, setDeleteAccountRegion] =
    useState<RegionValue>("AMERICA_NORTH");
  const [transferAccountRiotId, setTransferAccountRiotId] = useState("");
  const [transferAccountRegion, setTransferAccountRegion] =
    useState<RegionValue>("AMERICA_NORTH");
  const [transferTargetAlias, setTransferTargetAlias] = useState("");

  function requireValue(value: string, label: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      props.onError(`${label} is required.`);
      return null;
    }
    return trimmed;
  }

  function parseRiotId(value: string): string | null {
    const parsed = RiotIdSchema.safeParse(value);
    if (!parsed.success) {
      props.onError("Riot ID must be in the form game_name#tag.");
      return null;
    }
    return value;
  }

  const addAccountMutation = useMutation(
    trpc.player.addAccount.mutationOptions({
      onSuccess: () => {
        props.onSuccess("Account added.");
        const alias = addAccountAlias.trim();
        if (alias.length > 0) {
          void navigate(
            `/g/${props.guildId}/players/${encodeURIComponent(alias)}`,
          );
        }
      },
      onError: (err) => {
        props.onError(err.message);
      },
    }),
  );
  const deleteAccountMutation = useMutation(
    trpc.player.deleteAccount.mutationOptions({
      onSuccess: () => {
        props.onSuccess("Account deleted.");
      },
      onError: (err) => {
        props.onError(err.message);
      },
    }),
  );
  const transferAccountMutation = useMutation(
    trpc.player.transferAccount.mutationOptions({
      onSuccess: (result) => {
        props.onSuccess("Account transferred.");
        void navigate(
          `/g/${props.guildId}/players/${encodeURIComponent(result.toPlayerAlias)}`,
        );
      },
      onError: (err) => {
        props.onError(err.message);
      },
    }),
  );

  return (
    <>
      <AdminCard title="Add account">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const playerAlias = requireValue(addAccountAlias, "Alias");
            const riotId = parseRiotId(addAccountRiotId);
            if (playerAlias === null || riotId === null) return;
            addAccountMutation.mutate({
              guildId: props.guildId,
              playerAlias,
              riotId,
              region: addAccountRegion,
            });
          }}
        >
          <TextField
            id="add-account-alias"
            label="Alias"
            value={addAccountAlias}
            onChange={setAddAccountAlias}
          />
          <RiotAccountFields
            riotIdInputId="add-account-riot"
            regionInputId="add-account-region"
            riotId={addAccountRiotId}
            region={addAccountRegion}
            onRiotIdChange={setAddAccountRiotId}
            onRegionChange={setAddAccountRegion}
          />
          <SubmitButton pending={addAccountMutation.isPending} label="Add" />
        </form>
      </AdminCard>

      <AdminCard title="Delete account">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const riotId = parseRiotId(deleteAccountRiotId);
            if (riotId === null) return;
            if (!globalThis.confirm(`Delete account "${riotId}"?`)) return;
            deleteAccountMutation.mutate({
              guildId: props.guildId,
              riotId,
              region: deleteAccountRegion,
            });
          }}
        >
          <RiotAccountFields
            riotIdInputId="delete-account-riot"
            regionInputId="delete-account-region"
            riotId={deleteAccountRiotId}
            region={deleteAccountRegion}
            onRiotIdChange={setDeleteAccountRiotId}
            onRegionChange={setDeleteAccountRegion}
          />
          <SubmitButton
            pending={deleteAccountMutation.isPending}
            label="Delete"
            variant="destructive"
          />
        </form>
      </AdminCard>

      <AdminCard title="Transfer account">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const riotId = parseRiotId(transferAccountRiotId);
            const toPlayerAlias = requireValue(
              transferTargetAlias,
              "Target alias",
            );
            if (riotId === null || toPlayerAlias === null) return;
            transferAccountMutation.mutate({
              guildId: props.guildId,
              riotId,
              region: transferAccountRegion,
              toPlayerAlias,
            });
          }}
        >
          <RiotAccountFields
            riotIdInputId="transfer-account-riot"
            regionInputId="transfer-account-region"
            riotId={transferAccountRiotId}
            region={transferAccountRegion}
            onRiotIdChange={setTransferAccountRiotId}
            onRegionChange={setTransferAccountRegion}
          />
          <TextField
            id="transfer-target"
            label="Target alias"
            value={transferTargetAlias}
            onChange={setTransferTargetAlias}
          />
          <SubmitButton
            pending={transferAccountMutation.isPending}
            label="Transfer"
          />
        </form>
      </AdminCard>
    </>
  );
}
