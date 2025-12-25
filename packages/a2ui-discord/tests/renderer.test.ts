import { describe, it, expect } from "bun:test";
import {
  renderToDiscord,
  parseButtonInteraction,
  SurfaceManager,
  processNdjson,
} from "../src/index.js";
import type { A2UIComponent } from "../src/index.js";

describe("renderToDiscord", () => {
  it("renders a simple text component", () => {
    const components: A2UIComponent[] = [
      {
        id: "text1",
        component: {
          Text: {
            text: { literalString: "Hello, Discord!" },
          },
        },
      },
    ];

    const result = renderToDiscord("text1", components, {}, "surface1");

    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0]?.description).toBe("Hello, Discord!");
    expect(result.components).toHaveLength(0);
  });

  it("renders text with heading hints as markdown", () => {
    const components: A2UIComponent[] = [
      {
        id: "heading",
        component: {
          Text: {
            text: { literalString: "Main Title" },
            usageHint: "h1",
          },
        },
      },
    ];

    const result = renderToDiscord("heading", components, {}, "surface1");

    expect(result.embeds[0]?.description).toBe("# Main Title");
  });

  it("renders a button", () => {
    const components: A2UIComponent[] = [
      {
        id: "btn1",
        component: {
          Button: {
            child: "btnLabel",
            primary: true,
            action: { name: "click" },
          },
        },
      },
      {
        id: "btnLabel",
        component: {
          Text: { text: { literalString: "Click Me" } },
        },
      },
    ];

    const result = renderToDiscord("btn1", components, {}, "surface1");

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.components).toHaveLength(1);
  });

  it("renders a card with child content", () => {
    const components: A2UIComponent[] = [
      {
        id: "card1",
        component: {
          Card: { child: "cardContent" },
        },
      },
      {
        id: "cardContent",
        component: {
          Text: { text: { literalString: "Card content here" } },
        },
      },
    ];

    const result = renderToDiscord("card1", components, {}, "surface1");

    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0]?.description).toBe("Card content here");
    expect(result.embeds[0]?.color).toBe(0x5865f2);
  });

  it("renders a column with multiple children", () => {
    const components: A2UIComponent[] = [
      {
        id: "col1",
        component: {
          Column: {
            children: { explicitList: ["text1", "text2"] },
          },
        },
      },
      {
        id: "text1",
        component: {
          Text: { text: { literalString: "Line 1" } },
        },
      },
      {
        id: "text2",
        component: {
          Text: { text: { literalString: "Line 2" } },
        },
      },
    ];

    const result = renderToDiscord("col1", components, {}, "surface1");

    expect(result.embeds[0]?.description).toBe("Line 1\nLine 2");
  });

  it("renders a row with buttons", () => {
    const components: A2UIComponent[] = [
      {
        id: "row1",
        component: {
          Row: {
            children: { explicitList: ["btn1", "btn2"] },
          },
        },
      },
      {
        id: "btn1",
        component: {
          Button: {
            child: "lbl1",
            primary: true,
            action: { name: "action1" },
          },
        },
      },
      {
        id: "btn2",
        component: {
          Button: {
            child: "lbl2",
            primary: false,
            action: { name: "action2" },
          },
        },
      },
      {
        id: "lbl1",
        component: {
          Text: { text: { literalString: "Button 1" } },
        },
      },
      {
        id: "lbl2",
        component: {
          Text: { text: { literalString: "Button 2" } },
        },
      },
    ];

    const result = renderToDiscord("row1", components, {}, "surface1");

    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.components).toHaveLength(2);
  });

  it("renders a progress indicator", () => {
    const components: A2UIComponent[] = [
      {
        id: "progress1",
        component: {
          ProgressIndicator: {
            progress: { literalNumber: 0.7 },
            label: { literalString: "Loading..." },
          },
        },
      },
    ];

    const result = renderToDiscord("progress1", components, {}, "surface1");

    expect(result.embeds[0]?.description).toContain("Loading...");
    expect(result.embeds[0]?.description).toContain("▓");
    expect(result.embeds[0]?.description).toContain("70%");
  });

  it("renders an icon as emoji", () => {
    const components: A2UIComponent[] = [
      {
        id: "icon1",
        component: {
          Icon: { name: { literalString: "check-circle" } },
        },
      },
    ];

    const result = renderToDiscord("icon1", components, {}, "surface1");

    expect(result.embeds[0]?.description).toBe("✅");
  });

  it("renders a divider", () => {
    const components: A2UIComponent[] = [
      {
        id: "col1",
        component: {
          Column: {
            children: { explicitList: ["text1", "div1", "text2"] },
          },
        },
      },
      {
        id: "text1",
        component: {
          Text: { text: { literalString: "Before" } },
        },
      },
      {
        id: "div1",
        component: {
          Divider: { axis: "horizontal" },
        },
      },
      {
        id: "text2",
        component: {
          Text: { text: { literalString: "After" } },
        },
      },
    ];

    const result = renderToDiscord("col1", components, {}, "surface1");

    expect(result.embeds[0]?.description).toContain("───────────────────");
  });

  it("resolves data bindings", () => {
    const components: A2UIComponent[] = [
      {
        id: "text1",
        component: {
          Text: {
            text: { path: "/greeting" },
          },
        },
      },
    ];

    const dataModel = { greeting: "Hello from data model!" };

    const result = renderToDiscord("text1", components, dataModel, "surface1");

    expect(result.embeds[0]?.description).toBe("Hello from data model!");
  });
});

describe("parseButtonInteraction", () => {
  it("parses valid custom_id", () => {
    const customId = JSON.stringify({
      surfaceId: "surface1",
      componentId: "btn1",
      action: "click",
      context: { key: "value" },
    });

    const result = parseButtonInteraction(customId);

    expect(result).toEqual({
      surfaceId: "surface1",
      componentId: "btn1",
      action: "click",
      context: { key: "value" },
    });
  });

  it("returns null for invalid JSON", () => {
    const result = parseButtonInteraction("not-json");
    expect(result).toBeNull();
  });

  it("returns null for missing required fields", () => {
    const result = parseButtonInteraction(JSON.stringify({ foo: "bar" }));
    expect(result).toBeNull();
  });
});

describe("SurfaceManager", () => {
  it("processes surface updates", () => {
    const manager = new SurfaceManager();

    manager.processMessage({
      surfaceUpdate: {
        surfaceId: "surface1",
        components: [
          {
            id: "text1",
            component: {
              Text: { text: { literalString: "Hello" } },
            },
          },
        ],
      },
    });

    const surface = manager.getSurface("surface1");
    expect(surface).toBeDefined();
    expect(surface?.components.has("text1")).toBe(true);
  });

  it("processes data model updates", () => {
    const manager = new SurfaceManager();

    manager.processMessage({
      dataModelUpdate: {
        surfaceId: "surface1",
        contents: [{ key: "name", valueString: "Test" }],
      },
    });

    const surface = manager.getSurface("surface1");
    expect(surface?.dataModel).toEqual({ name: "Test" });
  });

  it("processes begin rendering", () => {
    const manager = new SurfaceManager();

    manager.processMessage({
      surfaceUpdate: {
        surfaceId: "surface1",
        components: [
          {
            id: "root",
            component: {
              Text: { text: { literalString: "Hello" } },
            },
          },
        ],
      },
    });

    manager.processMessage({
      beginRendering: {
        surfaceId: "surface1",
        root: "root",
      },
    });

    const surface = manager.getSurface("surface1");
    expect(surface?.isRendering).toBe(true);
    expect(surface?.rootId).toBe("root");
  });

  it("renders a surface", () => {
    const manager = new SurfaceManager();

    manager.processMessages([
      {
        surfaceUpdate: {
          surfaceId: "surface1",
          components: [
            {
              id: "root",
              component: {
                Text: { text: { literalString: "Hello" } },
              },
            },
          ],
        },
      },
      {
        beginRendering: {
          surfaceId: "surface1",
          root: "root",
        },
      },
    ]);

    const payload = manager.renderSurface("surface1");

    expect(payload).not.toBeNull();
    expect(payload?.embeds[0]?.description).toBe("Hello");
  });
});

describe("processNdjson", () => {
  it("processes NDJSON and returns rendered surfaces", () => {
    const ndjson = [
      JSON.stringify({
        surfaceUpdate: {
          surfaceId: "surface1",
          components: [
            {
              id: "root",
              component: {
                Text: { text: { literalString: "NDJSON Test" } },
              },
            },
          ],
        },
      }),
      JSON.stringify({
        beginRendering: {
          surfaceId: "surface1",
          root: "root",
        },
      }),
    ].join("\n");

    const result = processNdjson(ndjson);

    expect(result.size).toBe(1);
    expect(result.get("surface1")?.embeds[0]?.description).toBe("NDJSON Test");
  });
});
