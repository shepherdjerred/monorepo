import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent(props: { source: string; className?: string }) {
  return (
    <div className={props.className}>
      <Markdown remarkPlugins={[remarkGfm]}>{props.source}</Markdown>
    </div>
  );
}
