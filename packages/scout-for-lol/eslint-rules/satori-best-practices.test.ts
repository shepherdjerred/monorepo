import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { satoriBestPractices } from "./satori-best-practices";

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
      projectService: false,
    },
  },
});

ruleTester.run("satori-best-practices", satoriBestPractices, {
  valid: [
    {
      name: "allows inline styles with display flex on multi-child elements",
      code: `<div style={{ display: 'flex' }}><span>A</span><span>B</span></div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      name: "allows single child without display property",
      code: `<div><span>A</span></div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      name: "allows data URL images",
      code: `<img src="data:image/png;base64,iVBORw0KGgo..." />`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      name: "allows supported HTML elements with display",
      code: `<div style={{ display: 'flex' }}><span>Text</span><p>Paragraph</p></div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      name: "allows conditional rendering with ternary",
      code: `<div>{condition ? <span>A</span> : <span>B</span>}</div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      name: "allows display contents",
      code: `<div style={{ display: 'contents' }}><span>A</span><span>B</span></div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      name: "ignores non-Satori files",
      code: `<div className="test"><input type="text" /></div>`,
      filename: "/workspaces/scout-for-lol/packages/backend/src/component.tsx",
    },
  ],
  invalid: [
    {
      name: "disallows className attribute",
      code: `<div className="container">Content</div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [
        {
          messageId: "noClassNames",
        },
      ],
    },
    {
      name: "disallows event handlers",
      code: `<button onClick={() => console.log('click')}>Click</button>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [
        {
          messageId: "noEventHandlers",
        },
      ],
    },
    {
      name: "disallows external image URLs",
      code: `<img src="https://example.com/image.png" />`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [
        {
          messageId: "noExternalImages",
        },
      ],
    },
    {
      name: "disallows unsupported HTML elements",
      code: `<form><input type="text" /></form>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [
        {
          messageId: "noHtmlElements",
        },
        {
          messageId: "noHtmlElements",
        },
      ],
    },
    {
      name: "disallows multi-child elements without display property",
      code: `<div><span>A</span><span>B</span></div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [
        {
          message:
            "Satori requires container elements with multiple children to have an explicit display property set to 'flex', 'contents', or 'none'. Add style={{display: 'flex'}} (or 'contents'/'none').",
        },
      ],
    },
    {
      name: "disallows React hooks in JSX",
      code: `<div>{useState(0)}</div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [
        {
          messageId: "noDynamicJsx",
        },
      ],
    },
    {
      name: "disallows CSS imports in Satori files",
      code: `import satori from "satori";\nimport "./styles.css";`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [
        {
          messageId: "noImportedStyles",
        },
      ],
    },
  ],
});
