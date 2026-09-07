/**
 * Result display component (review text and image)
 */
import type { GenerationResult } from "#src/lib/review-tool/config/schema.ts";

type ResultDisplayProps = {
  result: GenerationResult;
};

export function ResultDisplay({ result }: ResultDisplayProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-scout-ink mb-2">
          Review Text
        </h3>
        <div className="p-4 bg-scout-raised rounded border border-scout-border font-mono text-sm text-scout-ink whitespace-pre-wrap">
          {result.text}
        </div>
        <div className="mt-2 text-sm text-scout-subtle">
          Length: {result.text.length} characters
          {result.text.length > 400 && (
            <span className="ml-2 text-scout-warning font-medium">
              (⚠️ Exceeds 400 character limit)
            </span>
          )}
        </div>
      </div>

      {result.image !== undefined && result.image.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-scout-ink mb-2">
            Generated Image
          </h3>
          <img
            src={`data:image/png;base64,${result.image}`}
            alt="Generated review"
            className="w-full rounded border border-scout-border"
          />
        </div>
      )}
    </div>
  );
}
