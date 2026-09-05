export function isNonterminalDareState(state: string): boolean {
  return ["draft", "pending_accept", "activating", "active"].includes(state);
}

export function DareFact(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-scout-subtle">{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

export function DareStatePill(props: { state: string }) {
  return (
    <span className="rounded-full border border-scout-border px-2 py-0.5 text-xs capitalize">
      {props.state.replaceAll("_", " ")}
    </span>
  );
}
