import { Link } from "react-router";
import type { PermissionSet } from "@scout-for-lol/data";
import { Button } from "#src/components/ui/button.tsx";

export function PlayerHeaderActions(props: {
  guildId: string;
  alias: string;
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
      {canRename && (
        <Button
          type="button"
          variant="outline"
          size="sm"
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
