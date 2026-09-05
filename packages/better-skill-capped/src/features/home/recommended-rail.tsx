import React from "react";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { useContent } from "#src/hooks/use-content";
import { roleDisplayName } from "#src/model/role";
import { Badge } from "#components/ui/badge";

const RAIL_SIZE = 8;

/**
 * A "start here" rail of recommended courses, shown only in browse mode
 * (no query, no filters beyond the defaults). Replaces the manifest's
 * fragile marketing carousel with the `recommended` flag it already ships.
 */
export function RecommendedRail({
  visible,
}: {
  visible: boolean;
}): React.ReactElement | null {
  const { content } = useContent();
  if (!visible || content === undefined) {
    return null;
  }

  const recommended = content.courses
    .filter((course) => course.recommended)
    .slice(0, RAIL_SIZE);
  if (recommended.length === 0) {
    return null;
  }

  return (
    <section className="mb-5">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
        <Star className="size-4" /> Recommended courses
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
        {recommended.map((course) => (
          <Link
            key={course.uuid}
            to="/course/$courseUuid"
            params={{ courseUuid: course.uuid }}
            className="w-44 shrink-0 rounded-xl border bg-card transition-colors hover:bg-muted/50"
          >
            <img
              src={course.image}
              alt=""
              loading="lazy"
              className="aspect-video w-full rounded-t-xl object-cover"
            />
            <div className="p-2.5">
              <p className="line-clamp-2 text-sm font-medium">{course.title}</p>
              <Badge variant="secondary" className="mt-1.5">
                {roleDisplayName(course.role)}
              </Badge>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
