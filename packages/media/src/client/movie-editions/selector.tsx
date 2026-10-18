import {
  MOVIE_EDITION_REGISTRY,
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";

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
    <>
      <label>
        Movie edition
        <select
          required
          value={value}
          disabled={disabled}
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
        </select>
      </label>
      <p className="helper">
        Unmarked means the release does not assert a named cut. It does not mean
        theatrical.
      </p>
      {value !== "" && value !== "default" && (
        <p role="status">
          Your named-edition request will stay pending. Downloads for named
          editions are not available yet.
        </p>
      )}
    </>
  );
}
