/**
 * The `open` and `onOpenChange` props a Base UI root takes, with either
 * left out when the caller left it out, so an overlay is controlled only
 * when asked (`exactOptionalPropertyTypes` forbids passing `undefined`).
 */
export function openStateProps(
  open: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
): { open?: boolean; onOpenChange?: (open: boolean) => void } {
  return {
    ...(open === undefined ? {} : { open }),
    ...(onOpenChange === undefined
      ? {}
      : {
          onOpenChange: (next: boolean) => {
            onOpenChange(next);
          },
        }),
  };
}
