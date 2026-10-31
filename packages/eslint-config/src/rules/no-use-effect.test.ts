import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";
import { noUseEffect } from "./no-use-effect.ts";

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
      errors: [{ messageId: "useEffectWithoutDeps" }],
    },
    {
      code: `function Component() { useEffect(() => { console.log("every render"); }); return <div />; }`,
      errors: [{ messageId: "useEffectWithoutDeps" }],
    },
    {
      code: `function Component() { useEffect(() => { setFiltered(data.filter(x => x > 0)); }, [data]); return <div />; }`,
      errors: [{ messageId: "useEffectTransformData" }],
    },
    {
      code: `function Component() { useEffect(() => { window.addEventListener("resize", handler); }, [handler]); return <div />; }`,
      errors: [{ messageId: "useEffectEventHandler" }],
    },
    {
      code: `function Component() { useEffect(() => { setComment(""); }, [postId]); return <div />; }`,
      errors: [{ messageId: "useEffectStateSync" }],
    },
    {
      code: `function Component() { useEffect(() => { const socket = io(); return () => { socket.disconnect(); }; }, []); return <div />; }`,
      errors: [{ messageId: "useEffectWithoutDeps" }],
    },
    {
      code: `function Component() { useEffect(() => { if (disabled) releaseAll(); }, [disabled, releaseAll]); return <div />; }`,
      errors: [{ messageId: "useEffectWithDeps" }],
    },
  ],
});
