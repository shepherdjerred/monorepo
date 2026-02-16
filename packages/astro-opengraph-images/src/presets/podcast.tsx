import type { RenderFunctionInput } from "../types.js";
const { twj } = await import("tw-to-css");

// from https://fullstackheroes.com/resources/vercel-og-templates/podcast/
export async function podcast({ title }: RenderFunctionInput): Promise<React.ReactNode> {
  const image = "https://static.wikia.nocookie.net/arresteddevelopment/images/4/42/5x15_-_Michael_Bluth_01.jpg";

  return Promise.resolve(
    <div style={twj("h-full w-full flex items-start justify-start bg-yellow-100 p-20")}>
      <div style={twj("flex h-full items-center w-full")}>
        <div style={twj("flex-1 flex flex-col mr-20")}>
          <h1 style={twj("text-6xl")}>{title}</h1>
        </div>
        <div style={twj("flex relative")}>
          <svg
            style={twj("absolute top-[-300px] left-[-100px] opacity-20")}
            id="visual"
            viewBox="0 0 900 600"
            width="900"
            height="600"
            version="1.1"
          >
            <g transform="translate(444.3593826782917 273.8643784322123)">
              <path
                fill="#ef4444"
                d="M186.1 -166.4C230.8 -141.4 249.4 -70.7 237.7 -11.7C226 47.4 184.1 94.8 139.4 139.9C94.8 185.1 47.4 228 -2.2 230.3C-51.9 232.5 -103.7 194 -149.2 148.9C-194.7 103.7 -233.9 51.9 -229.5 4.4C-225.1 -43.1 -177.3 -86.3 -131.8 -111.3C-86.3 -136.3 -43.1 -143.1 13.8 -156.9C70.7 -170.7 141.4 -191.4 186.1 -166.4"
              ></path>
            </g>
          </svg>
          <img
            style={{
              ...twj("mx-auto border-8 border-red-500 w-[300px] h-[300px] rounded-full"),
              ...{ objectFit: "cover" },
            }}
            src={image}
          />
        </div>
      </div>
    </div>,
  );
}
