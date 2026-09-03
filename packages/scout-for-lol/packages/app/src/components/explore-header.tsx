import type { ReactNode } from "react";
import { Link2Off, Menu, Share2 } from "lucide-react";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@scout-for-lol/design-system/components/sheet";

/**
 * Title row: the mobile drawer trigger, the conversation name, and the
 * per-conversation actions. Split out of {@link Explore} to keep that
 * function within the complexity budget.
 */
export function ExploreHeader(props: {
  title: string;
  drawerOpen?: boolean;
  onDrawerOpenChange?: (open: boolean) => void;
  sidebar?: ReactNode;
  extraActions?: ReactNode;
  actions?: {
    shared: boolean;
    sharing: boolean;
    revoking: boolean;
    onExport?: () => void;
    onShare: () => void;
    onRevoke: () => void;
  };
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {props.sidebar !== undefined &&
          props.drawerOpen !== undefined &&
          props.onDrawerOpenChange !== undefined && (
            <div className="md:hidden">
              <Sheet
                open={props.drawerOpen}
                onOpenChange={props.onDrawerOpenChange}
              >
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Conversations"
                    title="Conversations"
                  >
                    <Menu className="size-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetTitle className="text-sm font-medium">
                    Conversations
                  </SheetTitle>
                  {props.sidebar}
                </SheetContent>
              </Sheet>
            </div>
          )}
        {/* The page's primary heading, so h1 — axe flagged both Explore routes
            for page-has-heading-one while this was an h2 and nothing else on
            the page claimed the top level. explore-shared.tsx already renders
            the same title as an h1 with these exact classes; this was the
            outlier, and the visual result is unchanged. */}
        <h1 className="truncate text-xl font-semibold tracking-tight">
          {props.title}
        </h1>
      </div>

      {(props.actions !== undefined || props.extraActions !== undefined) && (
        <div className="flex shrink-0 items-center gap-1">
          {props.extraActions}
          {props.actions !== undefined && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={props.actions.sharing}
                onClick={props.actions.onShare}
              >
                <Share2 className="size-4" />
                {props.actions.shared ? "Copy link" : "Share"}
              </Button>
              {props.actions.shared && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Stop sharing"
                  title="Stop sharing"
                  disabled={props.actions.revoking}
                  onClick={props.actions.onRevoke}
                >
                  <Link2Off className="size-4" />
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
