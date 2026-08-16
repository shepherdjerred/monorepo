import React from "react";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import type { Course } from "#src/model/content";
import { Badge } from "#components/ui/badge";

/**
 * Curation badges (recommended / season / marketing) plus clickable topic
 * tags that jump to a tag-filtered search.
 */
export function CourseBadges({
  course,
}: {
  course: Course;
}): React.ReactElement | null {
  const hasBadges =
    course.recommended ||
    course.seasonString !== undefined ||
    course.marketingString !== undefined ||
    course.tags.length > 0;
  if (!hasBadges) {
    return null;
  }

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {course.recommended && (
        <Badge className="gap-1 bg-amber-500 text-white dark:bg-amber-600">
          <Star className="size-3 fill-current" /> Recommended
        </Badge>
      )}
      {course.marketingString !== undefined && (
        <Badge variant="secondary">{course.marketingString}</Badge>
      )}
      {course.seasonString !== undefined && (
        <Badge variant="secondary">{course.seasonString}</Badge>
      )}
      {course.tags.map((tag) => (
        <Link key={tag} to="/" search={{ tag: [tag] }}>
          <Badge
            variant="outline"
            className="hover:bg-muted"
            title={`See everything tagged ${tag}`}
          >
            {tag}
          </Badge>
        </Link>
      ))}
    </div>
  );
}
