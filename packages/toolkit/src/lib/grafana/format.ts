export function getAlertStateEmoji(state: string): string {
  switch (state) {
    case "firing":
      return "\u{1F534}";
    case "pending":
      return "\u{1F7E1}";
    case "inactive":
      return "\u{1F7E2}";
    case "normal":
      return "\u{1F7E2}";
    default:
      return "\u{26AA}";
  }
}

export function getDatasourceTypeEmoji(type: string): string {
  switch (type) {
    case "prometheus":
      return "\u{1F4CA}";
    case "loki":
      return "\u{1F4DD}";
    case "elasticsearch":
      return "\u{1F50D}";
    case "graphite":
      return "\u{1F4C8}";
    case "influxdb":
      return "\u{1F4C9}";
    case "mysql":
    case "postgres":
    case "mssql":
      return "\u{1F5C3}\u{FE0F}";
    default:
      return "\u{1F50C}";
  }
}
