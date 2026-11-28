import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function TaskMarkdownPreview({ description }: { description: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      disallowedElements={["img"]}
      unwrapDisallowed
    >
      {description}
    </ReactMarkdown>
  );
}
