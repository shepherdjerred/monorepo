import { Button as ButtonPrimitive } from "@base-ui/react/button";

import { cn } from "#lib/utils";

export function Button({
  className,
  ...props
}: ButtonPrimitive.Props): React.JSX.Element {
  return <ButtonPrimitive className={cn("button", className)} {...props} />;
}
