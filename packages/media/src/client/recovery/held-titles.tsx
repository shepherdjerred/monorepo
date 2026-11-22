import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { CommandResultSchema } from "#shared/api.ts";
import type { RecoveryListSchema } from "#shared/recovery.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, writeApi } from "#client/api.ts";
import { holdReasonSentence } from "#client/presentation/recovery.ts";
import { Button, ButtonRow } from "#client/ui/button.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Callout } from "#client/ui/feedback.tsx";
import { CheckboxField, TextField } from "#client/ui/forms/field.tsx";
import { EmptyNote, Panel } from "#client/ui/panel.tsx";
import { Before, Plain, TextLink } from "./parts.tsx";
import { reviewPath } from "./paths.ts";
import styles from "./recovery.module.css";

const cx = classNames(styles);

type Hold = z.infer<typeof RecoveryListSchema>["holds"][number];

/** The held titles that match what was typed, grouped by why they are held. */
function groupedByReason(holds: readonly Hold[], filter: string) {
  const needle = filter.trim().toLocaleLowerCase();
  const groups = new Map<string, Hold[]>();
  for (const hold of holds) {
    if (needle !== "" && !hold.title.toLocaleLowerCase().includes(needle)) {
      continue;
    }
    groups.set(hold.reason, [...(groups.get(hold.reason) ?? []), hold]);
  }
  return [...groups];
}

/**
 * The owner's way into a household review: tick the held titles to include
 * and prepare it. Preparing captures the review; nothing is released until
 * the owner applies it from the review itself.
 */
export function HeldTitlesPanel({
  user,
  holds,
  id,
}: {
  user: MediaUser;
  holds: readonly Hold[];
  id?: string;
}) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [filter, setFilter] = useState("");
  const prepare = useMutation({
    mutationFn: () =>
      writeApi({
        actorId: user.id,
        path: "/recovery/reviews",
        body: { mediaIds: selected },
        schema: CommandResultSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["recovery"] });
    },
  });
  const groups = groupedByReason(holds, filter);
  const shown = groups.flatMap(([, rows]) => rows.map((row) => row.mediaId));
  const count = selected.length;
  const reviewId = prepare.data?.recoveryReviewId;
  return (
    <Panel
      title="Held titles"
      {...(id === undefined ? {} : { id })}
      description="Titles the restore left protected, because Media can no longer tell who asked for them or wanted to keep them. Tick the ones to review together."
    >
      {holds.length === 0 && (
        <EmptyNote>
          No title is held. Nothing needs a household review.
        </EmptyNote>
      )}
      {holds.length > 0 && (
        <div className={cx("stack")}>
          <Plain>
            Shared physical files automatically include every affected episode.
            A completed series request can be reviewed one physical group at a
            time; other episodes and future-series options remain unchanged.
            Existing Keep and pins remain effective.
          </Plain>
          <search className={cx("toolbar")}>
            <div className={cx("toolbarSearch")}>
              <TextField
                label="Find a held title"
                type="search"
                value={filter}
                autoComplete="off"
                onChange={(event) => {
                  setFilter(event.target.value);
                }}
              />
            </div>
            <ButtonRow>
              <Button
                variant="quiet"
                disabled={shown.length === 0}
                onClick={() => {
                  setSelected([...new Set([...selected, ...shown])]);
                }}
              >
                {filter.trim() === ""
                  ? `Tick all ${String(holds.length)}`
                  : `Tick the ${String(shown.length)} shown`}
              </Button>
              <Button
                variant="quiet"
                disabled={count === 0}
                onClick={() => {
                  setSelected([]);
                }}
              >
                Clear ticks
              </Button>
            </ButtonRow>
          </search>
          <p className={cx("count")} role="status">
            {filter.trim() === ""
              ? `${String(holds.length)} held ${holds.length === 1 ? "title" : "titles"}. `
              : `${String(shown.length)} of ${String(holds.length)} held titles match. `}
            {String(count)} ticked.
          </p>
          {groups.length === 0 && (
            <EmptyNote>No held title matches &ldquo;{filter}&rdquo;.</EmptyNote>
          )}
          <div className={cx("groups")}>
            {groups.map(([reason, rows]) => (
              <fieldset className={cx("group")} key={reason}>
                <legend className={cx("groupLegend")}>
                  {holdReasonSentence(reason)} ({rows.length})
                </legend>
                <ul className={cx("ticks")}>
                  {rows.map((hold) => (
                    <li key={hold.mediaId}>
                      <CheckboxField
                        label={hold.title}
                        checked={selected.includes(hold.mediaId)}
                        onChange={(event) => {
                          setSelected(
                            event.target.checked
                              ? [...selected, hold.mediaId]
                              : selected.filter(
                                  (item) => item !== hold.mediaId,
                                ),
                          );
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
          </div>
          <Before>
            {count === 0 ? (
              <>Tick at least one title to prepare a review.</>
            ) : (
              <>
                Preparing captures{" "}
                <strong>
                  {count} {count === 1 ? "title" : "titles"}
                </strong>{" "}
                in one review. Each person it concerns then declares what they
                still want. Nothing is released and no request or Keep changes
                until you apply the review.
              </>
            )}
          </Before>
          <ButtonRow>
            <Button
              variant="primary"
              disabled={count === 0}
              busy={prepare.isPending}
              onClick={() => {
                prepare.mutate();
              }}
            >
              Prepare review
            </Button>
          </ButtonRow>
          {prepare.error !== null && (
            <Callout tone="danger" title="No review was prepared">
              {prepare.error.message} Your ticks are kept.
            </Callout>
          )}
          {reviewId !== undefined && (
            <Callout tone="ok" title="Review prepared">
              The selected titles are now in a review.{" "}
              <TextLink to={reviewPath(reviewId)}>
                Open the exact review
              </TextLink>
              .
            </Callout>
          )}
        </div>
      )}
    </Panel>
  );
}
