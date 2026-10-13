import { z } from "zod";

type MarkdownNode = {
  type: string;
  value?: string | undefined;
  children?: MarkdownNode[] | undefined;
  [key: string]: unknown;
};
const NodeSchema: z.ZodType<MarkdownNode> = z.lazy(() =>
  z.looseObject({
    type: z.string(),
    value: z.string().optional(),
    children: z.array(NodeSchema).optional(),
  }),
);

function linkIdentifiers(node: MarkdownNode): MarkdownNode {
  if (
    node.children === undefined ||
    ["link", "linkReference", "code", "inlineCode"].includes(node.type)
  )
    return node;
  return {
    ...node,
    children: node.children.flatMap((child) => {
      if (child.type !== "text" || child.value === undefined)
        return [linkIdentifiers(child)];
      return child.value
        .split(/\b([A-Z][A-Z0-9]*-[1-9]\d*)\b/u)
        .map((value, index) =>
          index % 2 === 0
            ? { type: "text", value }
            : {
                type: "link",
                url: `/issues/${value}`,
                children: [{ type: "text", value }],
              },
        );
    }),
  };
}
const transform = (tree: unknown) => linkIdentifiers(NodeSchema.parse(tree));
export function issueLinks() {
  return transform;
}
