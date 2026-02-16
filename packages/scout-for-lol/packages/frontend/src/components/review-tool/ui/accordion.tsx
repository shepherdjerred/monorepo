import type { ReactNode } from "react";
import { cn } from "./cn.ts";

type AccordionItem = {
  id: string;
  title: string;
  content: ReactNode;
  defaultOpen?: boolean;
};

type AccordionProps = {
  items: AccordionItem[];
  className?: string;
};

export function Accordion({ items, className }: AccordionProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {items.map((item) => (
        <details
          key={item.id}
          className="overflow-hidden rounded-lg border border-surface-200 bg-white shadow-sm"
          open={item.defaultOpen}
        >
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold text-surface-900 hover:bg-surface-50">
            {item.title}
            <span className="text-surface-500">▾</span>
          </summary>
          <div className="border-t border-surface-100 px-4 py-3">{item.content}</div>
        </details>
      ))}
    </div>
  );
}
