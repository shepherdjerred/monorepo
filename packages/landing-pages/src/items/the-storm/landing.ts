// `/posthog.js` installs its queueing stub before this module runs, unless DNT
// or a blocker stopped it; every call tolerates its absence.
declare global {
  interface Window {
    posthog?: { capture: (event: string, properties?: object) => void };
  }
}

type Edition = "java" | "bedrock";

function isEdition(value: string | undefined): value is Edition {
  return value === "java" || value === "bedrock";
}

const FLASH_MS = 1800;

function required<T extends Element>(
  root: ParentNode,
  selector: string,
  type: new () => T,
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof type))
    throw new Error(`Address card is missing ${selector}`);
  return element;
}

const connect = required(document, ".connect", HTMLElement);
const copyButton = required(
  connect,
  "button[data-copy-address]",
  HTMLButtonElement,
);

const choices = [
  ...connect.querySelectorAll<HTMLButtonElement>("[data-edition-choice]"),
];
const panels = [
  ...connect.querySelectorAll<HTMLElement>("[data-edition-panel]"),
];

function addressFor(edition: Edition): string {
  const address = connect
    .querySelector(`[data-edition-panel="${edition}"] .address`)
    ?.textContent.trim();
  if (address === undefined || address === "")
    throw new Error(`No ${edition} address on the card`);
  return address;
}

function select(edition: Edition) {
  connect.dataset["edition"] = edition;
  for (const choice of choices)
    choice.setAttribute(
      "aria-pressed",
      String(choice.dataset["editionChoice"] === edition),
    );
  for (const panel of panels)
    panel.hidden = panel.dataset["editionPanel"] !== edition;
}

for (const choice of choices) {
  const edition = choice.dataset["editionChoice"];
  if (!isEdition(edition))
    throw new Error(`Unknown edition: ${String(edition)}`);
  choice.addEventListener("click", () => {
    select(edition);
    window.posthog?.capture("storm_edition_selected", { edition });
  });
}

// Phones and tablets can only run Bedrock, so open there for them.
if (/Android|iPhone|iPad|iPod/u.test(navigator.userAgent)) select("bedrock");

const label = copyButton.textContent;
let reset: ReturnType<typeof setTimeout> | undefined;
function flash(text: string, state: string) {
  copyButton.textContent = text;
  copyButton.dataset["state"] = state;
  clearTimeout(reset);
  reset = setTimeout(() => {
    copyButton.textContent = label;
    delete copyButton.dataset["state"];
  }, FLASH_MS);
}

copyButton.addEventListener("click", () => {
  const edition = connect.dataset["edition"];
  if (!isEdition(edition))
    throw new Error(`Unknown edition: ${String(edition)}`);
  navigator.clipboard.writeText(addressFor(edition)).then(
    () => {
      flash("copied!", "copied");
      window.posthog?.capture("storm_server_address_copied", {
        edition,
        field: "address",
      });
      document.dispatchEvent(
        new CustomEvent("storm:server-address-copied", {
          detail: { edition, field: "address" },
        }),
      );
    },
    // Clipboard access can be denied; the address text stays selectable.
    () => {
      flash("select it", "failed");
    },
  );
});

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
