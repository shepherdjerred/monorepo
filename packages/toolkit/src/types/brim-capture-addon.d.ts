/**
 * The mitmproxy addon is embedded with a Bun text import
 * (`with { type: "text" }`), so the compiled `brim` binary can write it out
 * without the source tree.
 */
declare module "#capture/brim_capture.py" {
  const text: string;
  export default text;
}
