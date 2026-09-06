import { Link } from "react-router";
import type { PermissionSet } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";

export function PlayerHeaderActions(props: {
  guildId: string;
  alias: string;
  playerId?: number;
  showStats: boolean;
  playerLoaded: boolean;
  permissions: PermissionSet;
  deletePending: boolean;
  onRename: () => void;
  onMerge: () => void;
  onDelete: () => void;
}) {
  const canRename =
    props.playerLoaded && props.permissions.can("players", "update");
  const canMerge =
    props.playerLoaded && props.permissions.can("players", "merge");
  const canDelete =
    props.playerLoaded && props.permissions.can("players", "delete");

  return (
    <div className="flex flex-wrap gap-2">
      {props.playerId !== undefined && props.showStats && (
        <Button asChild variant="outline" size="sm">
          <Link to={`/players/${props.playerId.toString()}`}>View stats</Link>
        </Button>
      )}
      {canRename && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-haspopup="dialog"
          onClick={props.onRename}
        >
          Rename
        </Button>
      )}
      {canMerge && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-haspopup="dialog"
          onClick={props.onMerge}
        >
          Merge
        </Button>
      )}
      {canDelete && (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={props.deletePending}
          onClick={() => {
            if (
              !globalThis.confirm(
                `Delete "${props.alias}" and all linked accounts/subscriptions?`,
              )
            ) {
              return;
            }
            props.onDelete();
          }}
        >
          Delete
        </Button>
      )}
      <Button asChild variant="outline" size="sm">
        <Link to={`/g/${props.guildId}/players`}>Players</Link>
      </Button>
    </div>
  );
}
