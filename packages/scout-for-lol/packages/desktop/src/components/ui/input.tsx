import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type ComponentRef,
  type ComponentPropsWithoutRef,
} from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@scout-for-lol/desktop/lib/utils";

// Label component
const Label = forwardRef<
  ComponentRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-sm font-medium text-gray-200 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

// Input component
type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  helperText?: string;
  error?: string;
  icon?: ReactNode;
};

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, helperText, error, icon, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replaceAll(/\s+/g, "-");

    return (
      <div className="space-y-2.5">
        {label !== undefined && label.length > 0 && <Label htmlFor={inputId}>{label}</Label>}
        <div className="relative">
          {Boolean(icon) && (
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "flex h-10 w-full rounded-lg border bg-gray-800/50 px-4 py-2 text-sm text-gray-100 placeholder:text-gray-500",
              "transition-colors duration-200",
              "file:border-0 file:bg-transparent file:text-sm file:font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900",
              "disabled:cursor-not-allowed disabled:opacity-50",
              Boolean(icon) && "pl-10",
              error !== undefined && error.length > 0
                ? "border-discord-red focus-visible:ring-discord-red"
                : "border-gray-700 hover:border-gray-600 focus-visible:border-discord-blurple focus-visible:ring-discord-blurple",
              className,
            )}
            {...props}
          />
        </div>
        {(helperText !== undefined && helperText.length > 0 ?? error) && (
          <p
            className={cn(
              "text-xs",
              error !== undefined && error.length > 0 ? "text-discord-red" : "text-gray-500",
            )}
          >
            {error ?? helperText}
          </p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

// Select component
type SelectProps = InputHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  helperText?: string;
  children: ReactNode;
};

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, helperText, className, id, children, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replaceAll(/\s+/g, "-");

    return (
      <div className="space-y-2.5">
        {label !== undefined && label.length > 0 && <Label htmlFor={selectId}>{label}</Label>}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            "flex h-10 w-full rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-2 text-sm text-gray-100",
            "transition-colors duration-200",
            "hover:border-gray-600",
            "focus-visible:border-discord-blurple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-discord-blurple focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        {helperText !== undefined && helperText.length > 0 && <p className="text-xs text-gray-500">{helperText}</p>}
      </div>
    );
  },
);
Select.displayName = "Select";

export { Input, Select };
