import { Button } from "@scout-for-lol/design-system/components/button";

export type TimelineCursor = { offset: number };

export function TimelinePagination(props: {
  page: number;
  pending: boolean;
  nextCursor: TimelineCursor | null | undefined;
  onPrevious: () => void;
  onNext: (cursor: TimelineCursor) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-scout-subtle">
        Page {(props.page + 1).toString()}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={props.page === 0 || props.pending}
          onClick={props.onPrevious}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={
            props.nextCursor === null ||
            props.nextCursor === undefined ||
            props.pending
          }
          onClick={() => {
            if (props.nextCursor !== null && props.nextCursor !== undefined)
              props.onNext(props.nextCursor);
          }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
