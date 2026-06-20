import { Button } from "#src/components/ui/button.tsx";

/**
 * "Load more" button for cursor-paginated lists. Renders nothing when there
 * is no next page. Mirrors the original inline pattern from the player list.
 */
export function LoadMore(props: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}) {
  if (!props.hasNextPage) return null;
  return (
    <Button
      type="button"
      variant="outline"
      disabled={props.isFetchingNextPage}
      onClick={props.onLoadMore}
    >
      {props.isFetchingNextPage ? "Loading..." : "Load more"}
    </Button>
  );
}
