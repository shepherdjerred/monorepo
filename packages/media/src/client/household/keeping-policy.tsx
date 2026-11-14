import { useId } from "react";

export type KeepingChoice = "" | "keep" | "temporary";

export function KeepingPolicyChoice({
  owner,
  value,
  disabled = false,
  onChange,
}: {
  owner: boolean;
  value: KeepingChoice;
  disabled?: boolean;
  onChange: (value: KeepingChoice) => void;
}) {
  const id = useId();
  if (!owner)
    return (
      <p className="helper">
        Temporary request: we’ll keep it while you’re watching. You can renew
        your interest with Keep watching.
      </p>
    );
  return (
    <>
      <label htmlFor={id}>How long to keep it</label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        required
        onChange={(event) => {
          const selected = event.target.value;
          if (
            selected !== "" &&
            selected !== "keep" &&
            selected !== "temporary"
          )
            throw new Error("Unknown keeping policy");
          onChange(selected);
        }}
      >
        <option value="" disabled>
          Choose a keeping policy
        </option>
        <option value="keep">Keep indefinitely</option>
        <option value="temporary">
          Temporary — while someone is interested
        </option>
      </select>
    </>
  );
}
