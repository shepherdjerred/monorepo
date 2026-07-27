export type StructuredLogger = (
  level: "info" | "warning" | "error",
  message: string,
  fields?: Record<string, unknown>,
) => void;

export function createStructuredLogger(module?: string): StructuredLogger {
  return (level, message, fields = {}) => {
    console.warn(
      JSON.stringify({
        level,
        msg: message,
        component: "temporal-worker",
        ...(module === undefined ? {} : { module }),
        ...fields,
      }),
    );
  };
}
