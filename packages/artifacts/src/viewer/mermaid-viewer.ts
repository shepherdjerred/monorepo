/**
 * Renders one Mermaid diagram inside the sandboxed content origin. The
 * untrusted `.mmd` source is fetched relative to this page and parsed here,
 * never on the app origin.
 */
import mermaid from "mermaid";

async function main(): Promise<void> {
  const root = document.querySelector("#diagram");
  const source = document.body.dataset["source"];
  if (root === null || source === undefined) return;
  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    const text = await response.text();
    const dark = globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
    });
    const { svg } = await mermaid.render("diagram-svg", text);
    root.innerHTML = svg;
  } catch (error) {
    root.textContent = `Could not render the diagram: ${
      error instanceof Error ? error.message : "unknown error"
    }`;
    root.className = "error";
  }
  globalThis.dispatchEvent(new Event("ab:redraw"));
}

void main();
