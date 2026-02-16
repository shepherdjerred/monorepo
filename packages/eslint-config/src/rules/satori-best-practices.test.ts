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
      code: `<div style={{ display: 'flex' }}><span>A</span><span>B</span></div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      code: `<div><span>A</span></div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      code: `<img src="data:image/png;base64,iVBORw0KGgo..." />`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      code: `<div style={{ display: 'flex' }}><span>Text</span><p>Paragraph</p></div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      code: `<div>{condition ? <span>A</span> : <span>B</span>}</div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      code: `<div style={{ display: 'contents' }}><span>A</span><span>B</span></div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
    },
    {
      code: `<div className="test"><input type="text" /></div>`,
      filename: "/workspaces/scout-for-lol/packages/backend/src/component.tsx",
    },
  ],
  invalid: [
    {
      code: `<div className="container">Content</div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [{ messageId: "noClassNames" }],
    },
    {
      code: `<button onClick={() => console.log('click')}>Click</button>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [{ messageId: "noEventHandlers" }],
    },
    {
      code: `<img src="https://example.com/image.png" />`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [{ messageId: "noExternalImages" }],
    },
    {
      code: `<form><input type="text" /></form>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [{ messageId: "noHtmlElements" }, { messageId: "noHtmlElements" }],
    },
    {
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
      code: `<div>{useState(0)}</div>`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [{ messageId: "noDynamicJsx" }],
    },
    {
      code: `import satori from "satori";\nimport "./styles.css";`,
      filename: "/workspaces/scout-for-lol/packages/report/src/component.tsx",
      errors: [{ messageId: "noImportedStyles" }],
    },
  ],
});
