import type { RenderFunctionInput } from "../types.js";

export async function gradients({ title, description }: RenderFunctionInput): Promise<React.ReactNode> {
  return Promise.resolve(
    <div
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        backgroundImage: "linear-gradient(to bottom, #dbf4ff, #fff1f1)",
        fontSize: 60,
        letterSpacing: -2,
        fontWeight: 700,
        textAlign: "center",
      }}
    >
      <div
        style={{
          backgroundImage: "linear-gradient(90deg, rgb(0, 124, 240), rgb(0, 223, 216))",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {title}
      </div>
      <div
        style={{
          backgroundImage: "linear-gradient(90deg, rgb(121, 40, 202), rgb(255, 0, 128))",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {description ?? ""}
      </div>
    </div>,
  );
}
