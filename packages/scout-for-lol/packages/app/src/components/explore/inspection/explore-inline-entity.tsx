import { useEffect, useRef, useState } from "react";
import type { ExploreMessage } from "@scout-for-lol/data";
import { GameAssetImage } from "@scout-for-lol/design-system/assets";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@scout-for-lol/design-system/components/overlays/popover";

type Entity = NonNullable<ExploreMessage["inlineEntities"]>[number];

/** A keyboard accessible description; hover, focus and tap all open it. */
export function ExploreInlineEntity({ entity }: { entity: Entity }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const cancelClose = () => {
    clearTimeout(closeTimer.current);
  };
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      setOpen(false);
    }, 150);
  };
  useEffect(
    () => () => {
      clearTimeout(closeTimer.current);
    },
    [],
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 align-middle rounded-sm text-inherit underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-scout-accent"
          aria-label={`${entity.name}: show description`}
          onMouseEnter={show}
          onMouseLeave={closeSoon}
          onFocus={show}
          onBlur={closeSoon}
          onClick={(event) => {
            // Focus opens the description before a touch click reaches Radix.
            // Keep that click from immediately toggling it closed again.
            event.preventDefault();
            show();
          }}
        >
          <GameAssetImage
            kind={entity.kind}
            assetKey={entity.assetKey}
            alt=""
            className="size-5 rounded-sm"
          />
          {entity.name}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-3 text-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        onMouseEnter={cancelClose}
        onMouseLeave={closeSoon}
        onEscapeKeyDown={() => {
          setOpen(false);
        }}
      >
        <p className="font-semibold">{entity.name}</p>
        <p className="mt-2">{entity.description}</p>
        <p className="mt-2 text-xs text-scout-subtle">
          Bundled data · {entity.version}
        </p>
      </PopoverContent>
    </Popover>
  );
}
