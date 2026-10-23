// `/posthog.js` installs its queueing stub before this module runs, unless DNT
// or a blocker stopped it; every call tolerates its absence.
declare global {
  interface Window {
    posthog?: { capture: (event: string, properties?: object) => void };
  }
}

type Edition = "java" | "bedrock";
type Field = "address" | "port";

function isEdition(value: string | undefined): value is Edition {
  return value === "java" || value === "bedrock";
}

function isField(value: string | undefined): value is Field {
  return value === "address" || value === "port";
}

const FLASH_MS = 1800;

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "button[data-copy]",
)) {
  const { copy, edition, field } = button.dataset;
  if (copy === undefined || !isEdition(edition) || !isField(field)) {
    throw new Error(
      `Copy button is missing its server data: ${button.outerHTML}`,
    );
  }
  const label = button.textContent;
  let reset: ReturnType<typeof setTimeout> | undefined;
  const flash = (text: string, state: string) => {
    button.textContent = text;
    button.dataset["state"] = state;
    clearTimeout(reset);
    reset = setTimeout(() => {
      button.textContent = label;
      delete button.dataset["state"];
    }, FLASH_MS);
  };

  button.addEventListener("click", () => {
    navigator.clipboard.writeText(copy).then(
      () => {
        flash("copied!", "copied");
        window.posthog?.capture("storm_server_address_copied", {
          edition,
          field,
        });
        document.dispatchEvent(
          new CustomEvent("storm:server-address-copied", {
            detail: { edition, field },
          }),
        );
      },
      // Clipboard access can be denied; the address text stays selectable.
      () => {
        flash("copy it above", "failed");
      },
    );
  });
}

for (const link of document.querySelectorAll<HTMLAnchorElement>(
  "a[data-track]",
)) {
  const { track, placement } = link.dataset;
  link.addEventListener("click", () => {
    if (track === "discord") {
      window.posthog?.capture("storm_discord_clicked", { placement });
      document.dispatchEvent(new CustomEvent("storm:discord-clicked"));
    } else if (track === "docs") {
      window.posthog?.capture("storm_docs_clicked", { placement });
    } else {
      throw new Error(`Unknown tracked link: ${String(track)}`);
    }
  });
}

export {};
