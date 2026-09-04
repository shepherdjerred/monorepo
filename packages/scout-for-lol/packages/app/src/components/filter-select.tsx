export function FilterSelect<const Value extends string>(props: {
  label: string;
  value: Value;
  options: readonly Value[];
  onChange: (value: Value) => void;
}) {
  return (
    <label className="space-y-1 text-xs text-scout-subtle">
      <span>{props.label}</span>
      <select
        className="h-9 w-full rounded-md border border-scout-border bg-scout-surface px-2 text-sm text-scout-text"
        value={props.value}
        onChange={(event) => {
          const parsed = props.options.find(
            (option) => option === event.target.value,
          );
          if (parsed !== undefined) props.onChange(parsed);
        }}
      >
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
