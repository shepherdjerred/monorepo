import type { RenderFunctionInput } from "../types.js";
const { twj } = await import("tw-to-css");

// from https://fullstackheroes.com/resources/vercel-og-templates/simple/
export async function simpleBlog({ title, description }: RenderFunctionInput): Promise<React.ReactNode> {
  return Promise.resolve(
    <div style={twj("h-full w-full flex items-start justify-start border border-blue-500 border-[12px] bg-gray-50")}>
      <div style={twj("flex items-start justify-start h-full")}>
        <div style={twj("flex flex-col justify-between w-full h-full")}>
          <h1 style={twj("text-[80px] p-20 font-black text-left")}>{title}</h1>
          <div style={twj("text-2xl pb-10 px-20 font-bold mb-0")}>{description}</div>
        </div>
      </div>
    </div>,
  );
}
