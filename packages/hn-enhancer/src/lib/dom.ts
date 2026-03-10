export function getCommentRows(): NodeListOf<HTMLTableRowElement> {
  return document.querySelectorAll<HTMLTableRowElement>("tr.athing.comtr");
}

export function getCommentIndent(row: HTMLTableRowElement): number {
  const indentCell = row.querySelector<HTMLTableCellElement>("td.ind");
  return Number(indentCell?.getAttribute("indent") ?? 0);
}

export function getCommentUsername(row: HTMLTableRowElement): string | undefined {
  const el = row.querySelector<HTMLAnchorElement>("a.hnuser");
  if (!el) return undefined;
  return el.textContent;
}

export function getCommentText(row: HTMLTableRowElement): string {
  const el = row.querySelector<HTMLDivElement>("div.commtext");
  if (!el) return "";
  return el.textContent.trim();
}

export function getCommentId(row: HTMLTableRowElement): string {
  return row.id;
}

function getNextSibling(el: Element): HTMLTableRowElement | null {
  const next = el.nextElementSibling;
  if (next instanceof HTMLTableRowElement) return next;
  return null;
}

export function collapseThread(startRow: HTMLTableRowElement): void {
  const baseIndent = getCommentIndent(startRow);
  let sibling = getNextSibling(startRow);

  while (sibling) {
    if (!sibling.classList.contains("comtr")) {
      sibling = getNextSibling(sibling);
      continue;
    }

    const indent = getCommentIndent(sibling);
    if (indent <= baseIndent) break;

    sibling.style.display = "none";
    sibling = getNextSibling(sibling);
  }

  startRow.dataset.hnCollapsed = "true";
}

export function expandThread(startRow: HTMLTableRowElement): void {
  const baseIndent = getCommentIndent(startRow);
  let sibling = getNextSibling(startRow);

  while (sibling) {
    if (!sibling.classList.contains("comtr")) {
      sibling = getNextSibling(sibling);
      continue;
    }

    const indent = getCommentIndent(sibling);
    if (indent <= baseIndent) break;

    sibling.style.display = "";
    sibling = getNextSibling(sibling);
  }

  delete startRow.dataset.hnCollapsed;
}

export function getLoggedInUsername(): string | undefined {
  const userLink = document.querySelector<HTMLAnchorElement>('.pagetop a[href^="user?"]');
  if (!userLink) return undefined;
  return userLink.textContent;
}

export function getPageType(): string | undefined {
  return document.documentElement.getAttribute("op") ?? undefined;
}

export function observeCommentTree(callback: (addedRows: HTMLTableRowElement[]) => void): void {
  const commentTree = document.querySelector("table.comment-tree");
  if (!commentTree) return;

  const observer = new MutationObserver((mutations) => {
    const addedRows: HTMLTableRowElement[] = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLTableRowElement && node.classList.contains("comtr")) {
          addedRows.push(node);
        }
      }
    }
    if (addedRows.length > 0) {
      callback(addedRows);
    }
  });

  observer.observe(commentTree, { childList: true, subtree: true });
}
