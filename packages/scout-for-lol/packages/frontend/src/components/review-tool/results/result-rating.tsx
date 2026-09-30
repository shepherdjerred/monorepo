/**
 * Result rating component (star rating and notes)
 */
import { StarRating } from "./star-rating.tsx";

type ResultRatingProps = {
  rating: 1 | 2 | 3 | 4 | undefined;
  notes: string;
  onRatingChange: (rating: 1 | 2 | 3 | 4) => Promise<void>;
  onNotesChange: (notes: string) => Promise<void>;
};

export function ResultRating({
  rating,
  notes,
  onRatingChange,
  onNotesChange,
}: ResultRatingProps) {
  return (
    <div className="p-4 bg-scout-raised rounded border border-scout-border">
      <h3 className="text-sm font-semibold text-scout-ink mb-3">
        Rate this generation
      </h3>
      <div className="mb-3">
        <StarRating
          rating={rating}
          onRate={(newRating) => {
            void (async () => {
              try {
                await onRatingChange(newRating);
              } catch {
                // Error handling is done in the parent component
              }
            })();
          }}
          size="large"
        />
      </div>
      <div>
        <label
          htmlFor="rating-notes"
          className="block text-xs font-medium text-scout-subtle mb-1"
        >
          Notes (optional)
        </label>
        <textarea
          id="rating-notes"
          value={notes}
          onChange={(e) => {
            void (async () => {
              try {
                await onNotesChange(e.target.value);
              } catch {
                // Error handling is done in the parent component
              }
            })();
          }}
          placeholder="What did you like or dislike about this generation?"
          className="w-full px-3 py-2 text-sm bg-scout-surface text-scout-ink border border-scout-border rounded focus:outline-none focus:ring-2 focus:ring-scout-focus focus:border-transparent resize-vertical placeholder:text-scout-subtle"
          rows={2}
        />
      </div>
    </div>
  );
}
