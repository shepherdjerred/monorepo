export function SeriesRequestOptions({
  future,
  specials,
  onFutureChange,
  onSpecialsChange,
}: {
  future: boolean;
  specials: boolean;
  onFutureChange: (checked: boolean) => void;
  onSpecialsChange: (checked: boolean) => void;
}) {
  return (
    <>
      <label className="check-label">
        <input
          type="checkbox"
          checked={future}
          onChange={(event) => {
            onFutureChange(event.target.checked);
          }}
        />
        Include future episodes
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={specials}
          onChange={(event) => {
            onSpecialsChange(event.target.checked);
          }}
        />
        Include specials
      </label>
    </>
  );
}
