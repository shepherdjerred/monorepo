import {
  forwardRef,
  type HTMLAttributes,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
  useEffect,
  useRef,
} from "react";
import { cn } from "#src/lib/cn.ts";

export const Table = forwardRef<
  HTMLTableElement,
  TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const updateAccessibility = (): void => {
      const scrollable =
        wrapper.scrollWidth > wrapper.clientWidth + 1 ||
        wrapper.scrollHeight > wrapper.clientHeight + 1;
      if (scrollable) {
        wrapper.tabIndex = 0;
      } else {
        wrapper.removeAttribute("tabindex");
      }
    };
    const observer = new ResizeObserver(updateAccessibility);
    observer.observe(wrapper);
    const table = wrapper.querySelector("table");
    if (table !== null) observer.observe(table);
    updateAccessibility();
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="scout-table-wrap">
      <table ref={ref} className={cn("scout-table", className)} {...props} />
    </div>
  );
});
Table.displayName = "Table";
export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>((props, ref) => <thead ref={ref} {...props} />);
export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>((props, ref) => <tbody ref={ref} {...props} />);
export const TableRow = forwardRef<
  HTMLTableRowElement,
  HTMLAttributes<HTMLTableRowElement>
>((props, ref) => <tr ref={ref} {...props} />);
export const TableHead = forwardRef<
  HTMLTableCellElement,
  ThHTMLAttributes<HTMLTableCellElement>
>((props, ref) => <th ref={ref} {...props} />);
export const TableCell = forwardRef<
  HTMLTableCellElement,
  TdHTMLAttributes<HTMLTableCellElement>
>((props, ref) => <td ref={ref} {...props} />);
for (const component of [
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
])
  component.displayName = "TablePart";
