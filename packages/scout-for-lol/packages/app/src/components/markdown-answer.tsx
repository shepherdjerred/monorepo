import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders an explore answer as markdown.
 *
 * `skipHtml` is the sanitisation strategy: raw HTML in the source is dropped
 * rather than parsed, which is what the docs board does and what this repo has
 * instead of a rehype sanitiser. The content is model output rendered for the
 * person who asked for it, but that is not a reason to hand it an HTML
 * injection point.
 *
 * Memoised on the text because this renders during streaming — the answer
 * re-renders on every partial snapshot, and re-parsing an unchanged string is
 * pure waste. Half-typed syntax is expected mid-stream: a lone `**` shows as
 * asterisks until its pair arrives, which is the tradeoff of formatting live.
 *
 * There is no typography plugin in this app, so every element maps to explicit
 * classes below.
 */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-base font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 mb-2 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="underline underline-offset-2"
    >
      {children}
    </a>
  ),
  code: ({ children, className }) =>
    // react-markdown gives fenced blocks a language class and inline code
    // none, which is the only signal available to tell them apart here.
    className === undefined ? (
      <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
        {children}
      </code>
    ) : (
      <code className={className}>{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-md bg-muted p-3 text-xs last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 pl-3 text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-lg border last:mb-0">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border-t px-3 py-2">{children}</td>,
  hr: () => <hr className="my-4" />,
};

/**
 * `skipHtml` drops raw HTML, but markdown has its own image syntax and
 * `![](https://…)` survives it — the browser would fetch that URL on render.
 * A shared transcript renders through this same component for an anonymous
 * viewer, so an image the model was talked into emitting becomes a tracking
 * pixel firing from whoever opened the link. Nothing in an explore answer is
 * supposed to be an image, so the element is dropped rather than proxied.
 *
 * The alt text goes with it: alt is an attribute rather than child content, so
 * there is nothing to unwrap and the node disappears whole.
 */
const DISALLOWED_ELEMENTS = ["img"];

function MarkdownAnswerView(props: { children: string }) {
  return (
    <div className="text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        disallowedElements={DISALLOWED_ELEMENTS}
        components={COMPONENTS}
      >
        {props.children}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Memoised on the text: this renders on every streamed snapshot, and
 * re-parsing an unchanged string is pure waste.
 */
export const MarkdownAnswer = memo(MarkdownAnswerView);
