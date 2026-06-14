import { type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string | undefined;
};

export function Textarea({ label, className, id, ...props }: TextareaProps) {
  const textareaId = id ?? label?.toLowerCase().replaceAll(/\s+/g, "-");
  return (
    <div>
      {label != null && (
        <label
          htmlFor={textareaId}
          className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={cn(
          "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
          className,
        )}
        rows={4}
        {...props}
      />
    </div>
  );
}
