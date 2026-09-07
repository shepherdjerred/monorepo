#!/bin/sh

set -eu

STAGE=$1

case "$STAGE" in
planning | impl | pr | blocked | clear) ;;
*)
  printf 'mark-stage: unknown stage "%s"\n' "$STAGE" >&2
  exit 64
  ;;
esac

: "${HERDR_WORKSPACE_ID:?mark-stage: HERDR_WORKSPACE_ID is not set (no focused workspace)}"

# Written to both stores: the workspace-level token feeds herdr-board and
# `herdr workspace list` (spaces sidebar / grouping); the pane-level token
# on every pane in the workspace feeds the agents sidebar, which only reads
# $name tokens from pane metadata, not workspace metadata.
if [ "$STAGE" = clear ]; then
  herdr workspace report-metadata "$HERDR_WORKSPACE_ID" \
    --source herdr-stage \
    --clear-token stage
  PANE_ARGS="--clear-token stage"
else
  herdr workspace report-metadata "$HERDR_WORKSPACE_ID" \
    --source herdr-stage \
    --token "stage=$STAGE"
  PANE_ARGS="--token stage=$STAGE"
fi

herdr pane list --workspace "$HERDR_WORKSPACE_ID" | jq -r '.result.panes[].pane_id' |
  while IFS= read -r pane_id; do
    # shellcheck disable=SC2086 # PANE_ARGS is an intentional two-word flag+value pair
    herdr pane report-metadata "$pane_id" --source herdr-stage $PANE_ARGS
  done
