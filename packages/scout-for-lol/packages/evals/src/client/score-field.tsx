import type { EvalScore } from "#shared/schema.ts";

const OPTIONS: { score: EvalScore; label: string; hint: string }[] = [
  { score: 1, label: "Bad", hint: "Misses it" },
  { score: 2, label: "Okay", hint: "Gets there" },
  { score: 3, label: "Great", hint: "Nails it" },
];

export function ScoreField({
  defaultScore,
  description,
  legend,
  name,
  onScoreChange,
}: {
  defaultScore: EvalScore | undefined;
  description: string;
  legend: string;
  name: string;
  onScoreChange?: (score: EvalScore) => void;
}): React.JSX.Element {
  return (
    <fieldset className="score-field">
      <legend className="text-base font-semibold">{legend}</legend>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((option) => (
          <label className="score-option" key={option.score}>
            <input
              defaultChecked={defaultScore === option.score}
              name={name}
              onChange={() => {
                onScoreChange?.(option.score);
              }}
              required
              type="radio"
              value={option.score}
            />
            <span className="score-dot">{option.score}</span>
            <span className="min-w-0">
              <strong className="block text-sm">{option.label}</strong>
              <span className="block break-words text-xs text-slate-500">
                {option.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
