import React from "react";
import { z } from "zod";

type StarRatingProps = {
  rating: number | undefined;
  maxRating?: number;
  onRate?: (rating: 1 | 2 | 3 | 4) => void;
  size?: "small" | "medium" | "large";
  readonly?: boolean;
};

const SIZES = {
  small: 16,
  medium: 24,
  large: 32,
};

const RatingValueSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export function StarRating({
  rating,
  maxRating = 4,
  onRate,
  size = "medium",
  readonly = false,
}: StarRatingProps): React.ReactNode {
  const [hoverRating, setHoverRating] = React.useState<number | null>(null);

  const displayRating = hoverRating ?? rating ?? 0;
  const isInteractive = !readonly && onRate !== undefined;
  const starSize = SIZES[size];

  const handleClick = (starIndex: number) => {
    if (!isInteractive) {
      return;
    }

    // Validate starIndex is 1-4 using Zod
    const result = RatingValueSchema.safeParse(starIndex);
    if (result.success) {
      // TypeScript knows onRate is defined here because isInteractive = !readonly && onRate !== undefined
      onRate(result.data);
    }
  };

  return (
    <div
      role="presentation"
      style={{
        display: "inline-flex",
        gap: "4px",
        alignItems: "center",
      }}
      onMouseLeave={() => {
        if (isInteractive) {
          setHoverRating(null);
        }
      }}
    >
      {Array.from({ length: maxRating }, (_, index) => {
        const starNumber = index + 1;
        const isFilled = starNumber <= displayRating;

        return (
          <button
            key={starNumber}
            type="button"
            onClick={() => {
              handleClick(starNumber);
            }}
            onMouseEnter={() => {
              if (isInteractive) {
                setHoverRating(starNumber);
              }
            }}
            disabled={!isInteractive}
            style={{
              border: "none",
              background: "none",
              padding: 0,
              cursor: isInteractive ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "transform 0.1s ease",
            }}
            onMouseDown={(e) => {
              if (isInteractive) {
                e.currentTarget.style.transform = "scale(0.9)";
              }
            }}
            onMouseUp={(e) => {
              if (isInteractive) {
                e.currentTarget.style.transform = "scale(1)";
              }
            }}
            aria-label={`Rate ${starNumber.toString()} star${starNumber > 1 ? "s" : ""}`}
          >
            <svg
              width={starSize}
              height={starSize}
              viewBox="0 0 24 24"
              fill={isFilled ? "#fbbf24" : "#d1d5db"}
              stroke={isFilled ? "#f59e0b" : "#9ca3af"}
              strokeWidth="1.5"
              style={{
                transition: "fill 0.15s ease, stroke 0.15s ease",
              }}
            >
              <path
                d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        );
      })}
      {rating !== undefined && rating > 0 && (
        <span
          style={{
            marginLeft: "8px",
            fontSize: size === "small" ? "12px" : size === "medium" ? "14px" : "16px",
            color: "#6b7280",
            fontWeight: 500,
          }}
        >
          {rating}/{maxRating}
        </span>
      )}
    </div>
  );
}
