import {
  MOVIE_EDITION_REGISTRY,
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { SelectField } from "#client/ui/forms/field.tsx";

export function MovieEditionSelector({
  value,
  change,
  disabled,
}: {
  value: MovieEditionKey | "";
  change: (edition: MovieEditionKey | "") => void;
  disabled: boolean;
}) {
  return (
    <SelectField
      label="Movie edition"
      description="Unmarked means the release does not assert a named cut. It does not mean theatrical."
      required
      value={value}
      disabled={disabled}
      width="full"
      onChange={(event) => {
        change(
          event.target.value === ""
            ? ""
            : MovieEditionKeySchema.parse(event.target.value),
        );
      }}
    >
      <option value="">Choose an edition…</option>
      {MovieEditionKeySchema.options.map((edition) => (
        <option key={edition} value={edition}>
          {MOVIE_EDITION_REGISTRY[edition].displayLabel}
        </option>
      ))}
    </SelectField>
  );
}
