import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "bun:test";
import { noUseEffect } from "./no-use-effect";

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

ruleTester.run("no-use-effect", noUseEffect, {
  valid: [
    {
      code: `function Component() { return <div>Hello</div>; }`,
    },
    {
      code: `function Component() { const data = useMemo(() => compute(), [deps]); return <div>{data}</div>; }`,
    },
  ],
  invalid: [
    {
      code: `function Component() { useEffect(() => { console.log("mount"); }, []); return <div />; }`,
      output: `function Component() { ; return <div />; }`,
      errors: [{ messageId: "useEffectWithoutDeps" }],
    },
    {
      code: `function Component() { useEffect(() => { console.log("every render"); }); return <div />; }`,
      output: `function Component() { ; return <div />; }`,
      errors: [{ messageId: "useEffectWithoutDeps" }],
    },
    {
      code: `function Component() { useEffect(() => { setFiltered(data.filter(x => x > 0)); }, [data]); return <div />; }`,
      output: `function Component() { ; return <div />; }`,
      errors: [{ messageId: "useEffectTransformData" }],
    },
    {
      code: `function Component() { useEffect(() => { window.addEventListener("resize", handler); }, [handler]); return <div />; }`,
      output: `function Component() { ; return <div />; }`,
      errors: [{ messageId: "useEffectEventHandler" }],
    },
    {
      code: `function Component() { useEffect(() => { setComment(""); }, [postId]); return <div />; }`,
      output: `function Component() { ; return <div />; }`,
      errors: [{ messageId: "useEffectStateSync" }],
    },
  ],
});
