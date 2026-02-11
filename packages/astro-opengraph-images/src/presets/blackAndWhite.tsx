import type { RenderFunctionInput } from "../types.js";

export async function blackAndWhite({ title, description }: RenderFunctionInput): Promise<React.ReactNode> {
  return Promise.resolve(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#000",
        padding: "55px 70px",
        color: "#fff",
        fontFamily: "Commit Mono",
        fontSize: 72,
      }}
    >
      <div
        style={{
          marginTop: 96,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 40,
        }}
      >
        {description ?? ""}
      </div>
    </div>,
  );
}
