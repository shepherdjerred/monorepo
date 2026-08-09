import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "#lib/utils";

export function Input({
  className,
  ...props
}: React.ComponentProps<"input">): React.JSX.Element {
  return <InputPrimitive className={cn("input", className)} {...props} />;
}
