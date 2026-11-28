import { useLayoutEffect, useState, type RefObject } from "react";
import {
  useVirtualizer,
  useWindowVirtualizer,
  type Virtualizer,
} from "@tanstack/react-virtual";
import type { Row, RowData } from "@tanstack/react-table";
import type { DataTableFeatures } from "@shepherdjerred/console-ui/components/data/data-table-features.ts";
import type { DisplayItem } from "@shepherdjerred/console-ui/components/data/data-table-model.ts";
import {
  BodyLine,
  SpacerRow,
  type RowContext,
} from "@shepherdjerred/console-ui/components/data/data-table-parts.tsx";

type DataRow<T extends RowData> = Row<DataTableFeatures, T>;

/** Scrolls a body line into view; set by whichever body is mounted. */
export type ScrollToItem = (index: number) => void;

export type BodyProps<T extends RowData> = {
  readonly items: readonly DisplayItem<DataRow<T>>[];
  readonly ctx: RowContext<T>;
  readonly emptyText: string | undefined;
  readonly scrollTo: RefObject<ScrollToItem | null>;
};

/** Estimated heights: the row tokens, and a few lines for a detail. */
const ESTIMATE = { group: 32, row: 36, detail: 120 } as const;
const OVERSCAN = 12;

function EmptyBody({
  text,
  colCount,
}: {
  readonly text: string;
  readonly colCount: number;
}): React.JSX.Element {
  return (
    <tbody>
      <tr className="ui-table-empty">
        <td colSpan={colCount}>{text}</td>
      </tr>
    </tbody>
  );
}

/** Every line rendered; used below the virtualization threshold. */
export function PlainBody<T extends RowData>({
  items,
  ctx,
  emptyText,
  scrollTo,
}: BodyProps<T>): React.JSX.Element {
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  useLayoutEffect(() => {
    scrollTo.current = (index) => {
      body
        ?.querySelector(`[data-index="${String(index)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
  }, [body, scrollTo]);
  if (emptyText !== undefined) {
    return <EmptyBody text={emptyText} colCount={ctx.colCount} />;
  }
  return (
    <tbody ref={setBody}>
      {items.map((item, index) => (
        <BodyLine
          key={`${item.kind}:${item.key}`}
          item={item}
          ctx={ctx}
          index={index}
        />
      ))}
    </tbody>
  );
}

function VirtualLines<T extends RowData>({
  items,
  ctx,
  virtualizer,
}: {
  readonly items: readonly DisplayItem<DataRow<T>>[];
  readonly ctx: RowContext<T>;
  readonly virtualizer: AnyVirtualizer;
}): React.JSX.Element {
  const lines = virtualizer.getVirtualItems();
  const margin = virtualizer.options.scrollMargin;
  const first = lines[0];
  const last = lines.at(-1);
  const before = first === undefined ? 0 : first.start - margin;
  const after =
    last === undefined ? 0 : virtualizer.getTotalSize() - (last.end - margin);
  return (
    <>
      <SpacerRow height={before} colCount={ctx.colCount} />
      {lines.map((line) => {
        const item = items[line.index];
        return item === undefined ? null : (
          <BodyLine
            key={`${item.kind}:${item.key}`}
            item={item}
            ctx={ctx}
            index={line.index}
            measure={virtualizer.measureElement}
          />
        );
      })}
      <SpacerRow height={after} colCount={ctx.colCount} />
    </>
  );
}

function itemKey<T extends RowData>(
  item: DisplayItem<DataRow<T>> | undefined,
): string {
  return item === undefined ? "" : `${item.kind}:${item.key}`;
}

/** Offset of `body` from the top of the document, kept current on resize. */
function useDocumentOffset(body: HTMLElement | null): number {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (body === null) {
      return;
    }
    const measure = (): void => {
      setOffset(
        Math.round(body.getBoundingClientRect().top + globalThis.scrollY),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => {
      observer.disconnect();
    };
  }, [body]);
  return offset;
}

type AnyVirtualizer =
  | Virtualizer<Window, HTMLTableRowElement>
  | Virtualizer<HTMLDivElement, HTMLTableRowElement>;

/** The virtualizer options both scroll targets share. */
function lineOptions<T extends RowData>(
  items: readonly DisplayItem<DataRow<T>>[],
  scrollMargin: number,
) {
  return {
    count: items.length,
    estimateSize: (index: number) => ESTIMATE[items[index]?.kind ?? "row"],
    getItemKey: (index: number) => itemKey(items[index]),
    overscan: OVERSCAN,
    scrollMargin,
  };
}

/** The mounted body: lets row navigation scroll a line into view. */
function useScrollTo(
  scrollTo: RefObject<ScrollToItem | null>,
  virtualizer: AnyVirtualizer,
): void {
  useLayoutEffect(() => {
    scrollTo.current = (index) => {
      virtualizer.scrollToIndex(index, { align: "auto" });
    };
  }, [scrollTo, virtualizer]);
}

function VirtualBody<T extends RowData>({
  items,
  ctx,
  emptyText,
  virtualizer,
  onBody,
}: {
  readonly items: readonly DisplayItem<DataRow<T>>[];
  readonly ctx: RowContext<T>;
  readonly emptyText: string | undefined;
  readonly virtualizer: AnyVirtualizer;
  readonly onBody: (body: HTMLTableSectionElement | null) => void;
}): React.JSX.Element {
  if (emptyText !== undefined) {
    return <EmptyBody text={emptyText} colCount={ctx.colCount} />;
  }
  return (
    <tbody ref={onBody}>
      <VirtualLines items={items} ctx={ctx} virtualizer={virtualizer} />
    </tbody>
  );
}

/** Virtualized against the page scroll; the sticky header keeps working. */
export function WindowBody<T extends RowData>({
  items,
  ctx,
  emptyText,
  scrollTo,
}: BodyProps<T>): React.JSX.Element {
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  const virtualizer = useWindowVirtualizer<HTMLTableRowElement>(
    lineOptions(items, useDocumentOffset(body)),
  );
  useScrollTo(scrollTo, virtualizer);
  return (
    <VirtualBody
      items={items}
      ctx={ctx}
      emptyText={emptyText}
      virtualizer={virtualizer}
      onBody={setBody}
    />
  );
}

/** Virtualized inside the table's own scroll box (`virtualize.maxHeight`). */
export function ContainerBody<T extends RowData>({
  items,
  ctx,
  emptyText,
  scrollTo,
  scroller,
}: BodyProps<T> & {
  readonly scroller: RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const box = scroller.current;
    if (body === null || box === null) {
      return;
    }
    setScrollMargin(
      Math.round(
        body.getBoundingClientRect().top -
          box.getBoundingClientRect().top +
          box.scrollTop,
      ),
    );
  }, [body, scroller]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    ...lineOptions(items, scrollMargin),
    getScrollElement: () => scroller.current,
  });
  useScrollTo(scrollTo, virtualizer);
  return (
    <VirtualBody
      items={items}
      ctx={ctx}
      emptyText={emptyText}
      virtualizer={virtualizer}
      onBody={setBody}
    />
  );
}
