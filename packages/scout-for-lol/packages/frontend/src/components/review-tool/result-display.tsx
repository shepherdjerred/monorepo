/**
 * Result display component (review text and image)
 */
import type { GenerationResult } from "@scout-for-lol/frontend/lib/review-tool/config/schema";

type ResultDisplayProps = {
  result: GenerationResult;
};

export function ResultDisplay({ result }: ResultDisplayProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-surface-700 mb-2">Review Text</h3>
        <div className="p-4 bg-surface-50 rounded border border-surface-200 font-mono text-sm text-surface-900 whitespace-pre-wrap">
          {result.text}
        </div>
        <div className="mt-2 text-sm text-surface-600">
          Length: {result.text.length} characters
          {result.text.length > 400 && (
            <span className="ml-2 text-orange-600 font-medium">(⚠️ Exceeds 400 character limit)</span>
          )}
        </div>
      </div>

      {result.image && (
        <div>
          <h3 className="text-sm font-semibold text-surface-700 mb-2">Generated Image</h3>
          <img
            src={`data:image/png;base64,${result.image}`}
            alt="Generated review"
            className="w-full rounded border border-surface-200"
          />
        </div>
      )}
    </div>
  );
}
