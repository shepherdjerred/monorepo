import { type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string | undefined;
  options: { value: string; label: string }[];
};

export function Select({
  label,
  options,
  className,
  id,
  ...props
}: SelectProps) {
  const selectId = id ?? label?.toLowerCase().replaceAll(/\s+/g, "-");
  return (
    <div>
      {label != null && (
        <label
          htmlFor={selectId}
          className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={cn(
          "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
