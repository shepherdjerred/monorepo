import { debug } from "#src/lib/debug.ts";
import {
  collapseThread,
  expandThread,
  getCommentIndent,
  getCommentUsername,
} from "#src/lib/dom.ts";
import {
  addHiddenUser,
  getHiddenUsers,
  onHiddenUsersChanged,
  removeHiddenUser,
} from "#src/lib/storage.ts";
import type { Settings } from "#src/types/storage.ts";

let hiddenUsers: string[] = [];

export function initHideUser(_settings: Settings): void {
  void (async () => {
    hiddenUsers = await getHiddenUsers();
    processAllRows();
  })();

  onHiddenUsersChanged((users) => {
    const previouslyHidden = hiddenUsers;
    hiddenUsers = users;

    // Un-hide users that were removed from the list
    for (const user of previouslyHidden) {
      if (!users.includes(user)) {
        unhideUserComments(user);
      }
    }

    // Hide newly added users
    processAllRows();
  });
}

export function processRows(rows: Iterable<HTMLTableRowElement>): void {
  for (const row of rows) {
    injectHideButton(row);
    maybeHideRow(row);
  }
}

function processAllRows(): void {
  const rows =
    document.querySelectorAll<HTMLTableRowElement>("tr.athing.comtr");
  processRows(rows);
}

function injectHideButton(row: HTMLTableRowElement): void {
  if (row.querySelector(".hn-hide-btn")) return;

  const userLink = row.querySelector<HTMLAnchorElement>("a.hnuser");
  if (!userLink) return;

  const username = userLink.textContent;
  if (!username) return;

  const btn = document.createElement("button");
  btn.className = "hn-hide-btn";
  btn.textContent = "hide";
  btn.title = `Hide all comments from ${username}`;

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (username !== "" && hiddenUsers.includes(username)) {
      void removeHiddenUser(username);
    } else {
      void addHiddenUser(username);
    }
  });

  userLink.after(btn);
}

function maybeHideRow(row: HTMLTableRowElement): void {
  const username = getCommentUsername(row);
  if (username === undefined || username === "") return;

  if (hiddenUsers.includes(username)) {
    debug("hide-user", { username, action: "hide" });
    row.dataset.hnHiddenUser = "true";
    collapseThread(row);

    // Also dim the comment row itself
    const indent = getCommentIndent(row);
    const commtext = row.querySelector<HTMLDivElement>("div.commtext");
    if (commtext) {
      commtext.dataset.hnHiddenUser = "true";
    }

    // Show a small indicator
    let indicator = row.querySelector<HTMLSpanElement>(".hn-hidden-indicator");
    if (!indicator) {
      indicator = document.createElement("span");
      indicator.className = "hn-hidden-indicator";
      const comhead = row.querySelector(".comhead");
      if (comhead) {
        comhead.append(indicator);
      }
    }
    indicator.textContent = ` [hidden user, indent=${String(indent)}]`;
  }
}

function unhideUserComments(username: string): void {
  const rows =
    document.querySelectorAll<HTMLTableRowElement>("tr.athing.comtr");
  for (const row of rows) {
    const rowUser = getCommentUsername(row);
    if (rowUser === username) {
      delete row.dataset.hnHiddenUser;
      expandThread(row);

      const commtext = row.querySelector<HTMLDivElement>("div.commtext");
      if (commtext) {
        delete commtext.dataset.hnHiddenUser;
      }

      const indicator = row.querySelector<HTMLSpanElement>(
        ".hn-hidden-indicator",
      );
      if (indicator) {
        indicator.remove();
      }
    }
  }
}
