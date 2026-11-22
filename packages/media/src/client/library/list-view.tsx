import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import {
  LibraryKeepingResultSchema,
  type LibraryKeepingCommand,
} from "#shared/household/interests.ts";
import type { LibraryPageSchema } from "#shared/household/library.ts";
import { queryClient, writeApi } from "#client/api.ts";
import { LIBRARY_INTEREST_COPY } from "#client/presentation/interest.ts";
import {
  KEEPING_CHANGE_COPY,
  KEEPING_COPY,
  PROTECTION_COPY,
} from "#client/presentation/keeping.ts";
import {
  kindAndYear,
  libraryStatePhrase,
} from "#client/presentation/state-phrase.ts";
import { classNames } from "#client/ui/class-names.ts";
import { Poster } from "#client/ui/poster.tsx";
import { StatePill } from "#client/ui/poster-card.tsx";
import styles from "./library.module.css";

const cx = classNames(styles);

type LibraryItem = z.infer<typeof LibraryPageSchema>["items"][number];

/**
 * The owner's switch between keeping a title for good and keeping it only
 * while someone follows it. The command names the versions it was read at,
 * so a title that changed meanwhile is refused instead of overwritten.
 */
function KeepingControl({
  user,
  item,
  keeping,
}: {
  user: MediaUser;
  item: LibraryItem;
  keeping: NonNullable<LibraryItem["libraryKeeping"]>;
}) {
  const change = KEEPING_CHANGE_COPY[keeping.keepingPolicy];
  const save = useMutation({
    mutationFn: () =>
      writeApi({
        actorId: user.id,
        path: `/library/${encodeURIComponent(item.id)}/keeping-policy`,
        body: {
          schemaVersion: 1,
          mediaId: item.id,
          edition: "default",
          expectedMediaVersion: keeping.mediaVersion,
          expectedTargetVersion: keeping.targetVersion,
          keepingPolicy: change.next,
        } satisfies LibraryKeepingCommand,
        schema: LibraryKeepingResultSchema,
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["library"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["removals"] }),
      ]),
  });
  return (
    <div className={cx("rowAction")}>
      <button
        className="button subtle"
        type="button"
        disabled={save.isPending}
        aria-label={`${change.action}: ${item.title}`}
        onClick={() => {
          save.mutate();
        }}
      >
        {save.isPending ? "Saving…" : change.action}
      </button>
      {save.error !== null && (
        <p className={cx("rowError")} role="alert">
          {save.error.message}
        </p>
      )}
    </div>
  );
}

function Row({ user, item }: { user: MediaUser; item: LibraryItem }) {
  const interest = LIBRARY_INTEREST_COPY[item.myInterest];
  return (
    <li className={cx("row")}>
      <div className={cx("rowPoster")}>
        <Poster
          path={item.artwork.posterPath}
          title={item.title}
          sizes="48px"
        />
      </div>
      <div className={cx("rowTitle")}>
        <Link
          className={cx("rowLink")}
          to={`/media/${encodeURIComponent(item.id)}`}
        >
          {item.title}
        </Link>
        <p className={cx("rowDetail")}>{kindAndYear(item.kind, item.year)}</p>
        {interest !== null && <p className={cx("rowDetail")}>{interest}</p>}
      </div>
      <div className={cx("rowState")}>
        <StatePill state={libraryStatePhrase(item)} />
      </div>
      <div className={cx("rowKeeping")}>
        <p className={cx("rowKeepingLabel")}>{KEEPING_COPY[item.policy]}</p>
        <p className={cx("rowDetail")}>{PROTECTION_COPY[item.protection]}</p>
      </div>
      {item.libraryKeeping !== null && (
        <KeepingControl user={user} item={item} keeping={item.libraryKeeping} />
      )}
    </li>
  );
}

/**
 * The library as rows: more titles to a screen than the posters, and where
 * the owner changes how long each title is kept.
 */
export function LibraryList({
  user,
  items,
  busy,
}: {
  user: MediaUser;
  items: readonly LibraryItem[];
  busy: boolean;
}) {
  const canChange = items.some((item) => item.libraryKeeping !== null);
  return (
    <>
      {canChange && (
        <p className={cx("listNote")}>
          Keeping a title for good or just for now changes what the library does
          once nobody follows it. A title someone follows stays either way.
        </p>
      )}
      <ul className={cx("rows")} aria-label="Library titles" aria-busy={busy}>
        {items.map((item) => (
          <Row key={item.id} user={user} item={item} />
        ))}
      </ul>
    </>
  );
}
