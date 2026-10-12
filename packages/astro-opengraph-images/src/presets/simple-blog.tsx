import type { RenderFunctionInput } from "#src/types.js";
const { twj } = await import("tw-to-css");

// from https://fullstackheroes.com/resources/vercel-og-templates/simple/
export function simpleBlog({
  title,
  description,
}: RenderFunctionInput): React.ReactNode {
  return (
    <div
      style={{
        boxSizing: "border-box",
        ...twj(
          "h-full w-full flex items-start justify-start border border-blue-500 border-[12px] bg-gray-50",
        ),
        borderStyle: "solid",
      }}
    >
      <div style={twj("flex items-start justify-start h-full")}>
        <div style={twj("flex flex-col justify-between w-full h-full")}>
          <h1
            style={{
              boxSizing: "border-box",
              ...twj("text-[80px] p-20 font-black text-left"),
            }}
          >
            {title}
          </h1>
          <div
            style={{
              boxSizing: "border-box",
              ...twj("text-2xl pb-10 px-20 font-bold mb-0"),
            }}
          >
            {description}
          </div>
        </div>
      </div>
    </div>
  );
}
