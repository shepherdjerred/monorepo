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
      name: "allows components without useEffect",
      code: `function Component() { return <div>Hello</div>; }`,
    },
    {
      name: "allows useMemo",
      code: `function Component() { const data = useMemo(() => compute(), [deps]); return <div>{data}</div>; }`,
    },
  ],
  invalid: [
    {
      name: "disallows useEffect with empty deps",
      code: `function Component() { useEffect(() => { console.log("mount"); }, []); return <div />; }`,
      output: `function Component() { ; return <div />; }`,
      errors: [
        {
          messageId: "useEffectWithoutDeps",
        },
      ],
    },
    {
      name: "disallows useEffect without deps",
      code: `function Component() { useEffect(() => { console.log("every render"); }); return <div />; }`,
      output: `function Component() { ; return <div />; }`,
      errors: [
        {
          messageId: "useEffectWithoutDeps",
        },
      ],
    },
    {
      name: "disallows useEffect for data transformation",
      code: `function Component() { useEffect(() => { setFiltered(data.filter(x => x > 0)); }, [data]); return <div />; }`,
      output: `function Component() { ; return <div />; }`,
      errors: [
        {
          messageId: "useEffectTransformData",
        },
      ],
    },
    {
      name: "disallows useEffect for event handling",
      code: `function Component() { useEffect(() => { window.addEventListener("resize", handler); }, [handler]); return <div />; }`,
      output: `function Component() { ; return <div />; }`,
      errors: [
        {
          messageId: "useEffectEventHandler",
        },
      ],
    },
    {
      name: "disallows useEffect for state sync",
      code: `function Component() { useEffect(() => { setComment(""); }, [postId]); return <div />; }`,
      output: `function Component() { ; return <div />; }`,
      errors: [
        {
          messageId: "useEffectStateSync",
        },
      ],
    },
  ],
});
