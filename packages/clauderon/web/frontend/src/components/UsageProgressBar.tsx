import type { UsageWindow } from "@clauderon/shared";

type UsageProgressBarProps = {
  window: UsageWindow;
  title: string;
  subtitle?: string;
};

export function UsageProgressBar({
  window,
  title,
  subtitle,
}: UsageProgressBarProps) {
  const percentage = Math.min(window.utilization * 100, 100);
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 95;

  // Color scheme based on utilization
  const barColor = isAtLimit
    ? "hsl(0, 75%, 50%)" // Red
    : isNearLimit
      ? "hsl(45, 93%, 47%)" // Orange/Yellow
      : "hsl(142, 71%, 45%)"; // Green

  // Format the reset time
  const formatResetTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffMs < 0) {
      return "Should have reset already";
    } else if (diffHours < 1) {
      return `Resets in ${String(diffMinutes)} min`;
    } else if (diffHours < 24) {
      return `Resets in ${String(diffHours)} hr ${String(diffMinutes % 60)} min`;
    } else {
      return `Resets ${date.toLocaleString()}`;
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <h4 className="font-semibold text-sm">{title}</h4>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="text-right">
          <span className="font-mono text-sm font-semibold">
            {window.current.toLocaleString()} / {window.limit.toLocaleString()}
          </span>
          <div className="text-xs text-muted-foreground">
            {percentage.toFixed(1)}% used
          </div>
        </div>
      </div>

      {/* Progress bar - brutalist style */}
      <div
        className="h-6 border-2 border-primary bg-secondary/30"
        style={{ position: "relative" }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${String(percentage)}%`,
            backgroundColor: barColor,
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.1)",
          }}
        />
        {/* Percentage label inside bar */}
        <div
          className="absolute inset-0 flex items-center justify-center text-xs font-bold font-mono"
          style={{
            color: percentage > 50 ? "white" : "hsl(220, 90%, 10%)",
            textShadow: percentage > 50 ? "0 1px 2px rgba(0,0,0,0.3)" : "none",
          }}
        >
          {percentage.toFixed(0)}%
        </div>
      </div>

      {/* Reset time */}
      {window.resets_at && (
        <div className="text-xs text-muted-foreground">
          {formatResetTime(window.resets_at)}
        </div>
      )}
    </div>
  );
}
