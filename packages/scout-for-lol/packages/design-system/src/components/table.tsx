import {
  forwardRef,
  type HTMLAttributes,
  type TableHTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { cn } from "#src/lib/cn.ts";

export const Table = forwardRef<
  HTMLTableElement,
  TableHTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="scout-table-wrap">
    <table ref={ref} className={cn("scout-table", className)} {...props} />
  </div>
));
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
