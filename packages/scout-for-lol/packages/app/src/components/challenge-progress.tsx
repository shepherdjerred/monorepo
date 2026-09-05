import type { ChallengeProgress as ChallengeProgressValue } from "@scout-for-lol/data";
import { Badge } from "@scout-for-lol/design-system/components/badge";

export function ChallengeProgress(props: { progress: ChallengeProgressValue }) {
  const progress = props.progress;
  if (progress.kind === "boolean") {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">
          {progress.operator === "all"
            ? "Complete every goal"
            : "Complete any goal"}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {progress.children.map((child, index) => (
            <div className="rounded-md border p-3" key={index}>
              <ChallengeProgress progress={child} />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (progress.kind === "distinct") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">Distinct coverage</span>
          <Badge variant={progress.completed ? "default" : "outline"}>
            {progress.current.toString()} / {progress.target.toString()}
          </Badge>
        </div>
        {progress.missing.length > 0 ? (
          <p className="text-sm text-scout-subtle">
            Missing: {progress.missing.map((value) => value.label).join(", ")}
          </p>
        ) : (
          <p className="text-sm text-scout-success">Complete</p>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium">
        {progress.reducer.replaceAll("_", " ")}
      </span>
      <Badge variant={progress.completed ? "default" : "outline"}>
        {progress.current.toString()} / {progress.target.toString()}
      </Badge>
    </div>
  );
}
