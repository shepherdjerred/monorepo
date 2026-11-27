import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import {
  PageLoading,
  PageState,
} from "@scout-for-lol/design-system/domain/profile/page-states";
import type { ReactNode } from "react";
import { PAGE_COLUMN } from "#src/components/friendly-classes.ts";

/** The column a redesigned page sits in. */
export function FriendlyPage(props: { children: ReactNode }) {
  return <div className={PAGE_COLUMN}>{props.children}</div>;
}

/** Soft placeholders in the shape of a page of rows, while it loads. */
export function FriendlyPageLoading(props: { rows?: number }) {
  return (
    <FriendlyPage>
      <PageLoading shape="list" rows={props.rows ?? 6} label="Loading…" />
    </FriendlyPage>
  );
}

/** The page could not be read: say so, and offer the retry. */
export function FriendlyPageUnavailable(props: {
  id: string;
  title: string;
  lead: string;
  onRetry: () => void;
  /** A way out, beside Retry. */
  also?: ReactNode;
}) {
  return (
    <FriendlyPage>
      <PageState
        kind="unavailable"
        level={1}
        id={props.id}
        title={props.title}
        lead={props.lead}
        actions={
          <>
            <button
              type="button"
              className={chipVariants({ variant: "default" })}
              onClick={props.onRetry}
            >
              Retry
            </button>
            {props.also}
          </>
        }
      />
    </FriendlyPage>
  );
}
