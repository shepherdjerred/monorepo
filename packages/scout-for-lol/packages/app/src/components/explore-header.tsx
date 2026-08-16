import type { ReactNode } from "react";
import { Download, Link2Off, Menu, Share2 } from "lucide-react";
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
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  sidebar: ReactNode;
  actions?: {
    shared: boolean;
    sharing: boolean;
    revoking: boolean;
    onExport: () => void;
    onShare: () => void;
    onRevoke: () => void;
  };
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Sheet open={props.drawerOpen} onOpenChange={props.onDrawerOpenChange}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0 md:hidden"
              aria-label="Conversations"
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
        <h2 className="truncate text-xl font-semibold tracking-tight">
          {props.title}
        </h2>
      </div>

      {props.actions !== undefined && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Export as markdown"
            onClick={props.actions.onExport}
          >
            <Download className="size-4" />
          </Button>
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
              size="sm"
              className="size-8 p-0"
              aria-label="Stop sharing"
              title="Stop sharing"
              disabled={props.actions.revoking}
              onClick={props.actions.onRevoke}
            >
              <Link2Off className="size-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
