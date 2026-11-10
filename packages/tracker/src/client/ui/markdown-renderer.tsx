import { createContext, use } from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { issueLinks } from "#shared/markdown-links.ts";

type HastElement = NonNullable<ExtraProps["node"]>;
type HastChild = HastElement["children"][number];

/** The text of a task-list item, without the items nested beneath it. */
function ownText(node: HastChild): string {
  if (node.type === "text") {
    return node.value;
  }
  return node.type !== "element" ||
    node.tagName === "ul" ||
    node.tagName === "ol"
    ? ""
    : node.children.map((child) => ownText(child)).join("");
}

// A task-list checkbox is named by the text of the item it belongs to.
const TaskText = createContext<string | undefined>(undefined);
function TaskCheckbox({ checked }: { checked: boolean }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled
      aria-label={use(TaskText)}
    />
  );
}

/** The markdown pipeline; loaded on demand because it is the largest dependency. */
export function MarkdownRenderer({ body }: { body: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, issueLinks]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            rel="noreferrer"
            target={href?.startsWith("/") === true ? undefined : "_blank"}
          >
            {children}
          </a>
        ),
        img: ({ src, alt }) =>
          src?.startsWith("/attachments/") === true ? (
            <a href={src} target="_blank" rel="noreferrer">
              <img src={src} alt={alt ?? "Attachment"} loading="lazy" />
            </a>
          ) : (
            <a href={src} target="_blank" rel="noreferrer">
              {alt ?? "External image"}
            </a>
          ),
        li: ({ node, className, children }) => (
          <li className={className}>
            <TaskText
              value={
                node === undefined
                  ? undefined
                  : ownText(node).trim() || undefined
              }
            >
              {children}
            </TaskText>
          </li>
        ),
        // GFM task lists are the only inputs markdown produces.
        input: ({ checked }) => <TaskCheckbox checked={checked === true} />,
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
