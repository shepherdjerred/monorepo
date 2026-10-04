/** ATA VALUE is a normalized health score; only RAW_VALUE is Celsius. */
export function smartTemperatureCelsiusExpression(sataOnly = false): string {
  const selector = sataOnly ? '{type!="nvme"}' : "";
  const raw = `smartmon_temperature_celsius_raw_value${selector} or on(disk, instance) smartmon_airflow_temperature_cel_raw_value${selector}`;
  // Our NVMe parser emits its Celsius reading as _value. Never use ATA's
  // normalized _value column as a temperature, even if RAW_VALUE is absent.
  return `(${raw}${sataOnly ? "" : ' or on(disk, instance) smartmon_temperature_celsius_value{type="nvme"}'})`;
}
