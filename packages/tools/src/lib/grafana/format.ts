export function getAlertStateEmoji(state: string): string {
  switch (state) {
    case "firing":
      return "\uD83D\uDD34";
    case "pending":
      return "\uD83D\uDFE1";
    case "inactive":
      return "\uD83D\uDFE2";
    case "normal":
      return "\uD83D\uDFE2";
    default:
      return "\u26AA";
  }
}

export function getDatasourceTypeEmoji(type: string): string {
  switch (type) {
    case "prometheus":
      return "\uD83D\uDCCA";
    case "loki":
      return "\uD83D\uDCDD";
    case "elasticsearch":
      return "\uD83D\uDD0D";
    case "graphite":
      return "\uD83D\uDCC8";
    case "influxdb":
      return "\uD83D\uDCC9";
    case "mysql":
    case "postgres":
    case "mssql":
      return "\uD83D\uDDC3\uFE0F";
    default:
      return "\uD83D\uDD0C";
  }
}
