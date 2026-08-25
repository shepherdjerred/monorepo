import * as LabelPrimitive from "@radix-ui/react-label";
import {
  forwardRef,
  type FieldsetHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "#src/lib/cn.ts";

export const Label = forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn("scout-label", className)}
    {...props}
  />
));
Label.displayName = "Label";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("scout-control", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn("scout-control scout-textarea", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scout-field", className)} {...props} />;
}

export function FormSection(
  props: FieldsetHTMLAttributes<HTMLFieldSetElement> & {
    legend: ReactNode;
    description?: ReactNode;
  },
) {
  const { className, legend, description, children, ...fieldsetProps } = props;
  return (
    <fieldset
      className={cn("scout-form-section", className)}
      {...fieldsetProps}
    >
      <legend className="scout-form-section__legend">{legend}</legend>
      {description === undefined ? null : (
        <p className="scout-form-section__description">{description}</p>
      )}
      <div className="scout-form-section__content">{children}</div>
    </fieldset>
  );
}

export function FormActions({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scout-form-actions", className)} {...props} />;
}
export function FieldDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("scout-field__description", className)} {...props} />;
}
export function FieldError({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      aria-live="polite"
      className={cn("scout-field__error", className)}
      {...props}
    />
  );
}
