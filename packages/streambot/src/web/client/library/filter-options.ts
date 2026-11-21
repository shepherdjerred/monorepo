export type FilterOption = { readonly value: string; readonly label: string };

/** The options of a filter, with the current value kept in the list even before the list loads. */
export function withCurrent(
  options: readonly FilterOption[],
  current: string,
): readonly FilterOption[] {
  return current === "" || options.some((option) => option.value === current)
    ? options
    : [...options, { value: current, label: current }];
}
