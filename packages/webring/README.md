<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.rawgit.com/shepherdjerred/webring/main/assets/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://cdn.rawgit.com/shepherdjerred/webring/main/assets/logo-light.png">
    <img alt="webring logo" src="https://cdn.rawgit.com/shepherdjerred/webring/main/assets/logo-light.png" height=150>
  </picture>

[![webring](https://img.shields.io/npm/v/webring.svg)](https://www.npmjs.com/package/webring)

`webring` fetches the latest updates from your favorite RSS feeds.

This project is actively maintained. If you have a feature request or need help, please [create an issue](https://github.com/shepherdjerred/webring/issues/new).

</div>

## Installation

```bash
npm i webring
```

## Features

- Written in TypeScript
- Caching
- HTML sanitization and truncation

## Quick Start

This library is intended to be used with a static site generator. I use this with [Astro](https://astro.build/) on my [personal website](https://github.com/shepherdjerred/sjer.red/blob/1220ebef2e43956ba385402ed8529870e9084de8/src/components/BlogWebring.astro#L17-L22).

```typescript
import { run } from "webring";

const result = await run({
  sources: [
    {
      url: "https://drewdevault.com/blog/index.xml",
      title: "Drew DeVault",
    },
    {
      url: "https://danluu.com/atom.xml",
      title: "Dan Luu",
    },
    {
      url: "https://jakelazaroff.com/rss.xml",
      title: "Jake Lazaroff",
    },
  ],
});

console.log(result);
// [
//   {
//     title: 'A discussion of discussions on AI bias',
//     url: 'https://danluu.com/ai-bias/',
//     date: 2024-06-16T00:00:00.000Z,
//     source: { url: 'https://danluu.com/atom.xml', title: 'Dan Luu' },
//     preview: `There've been regular viral stories about ML/AI bias with LLMs and generative AI for the past couple years. One thing I find interesting about discussions of bias is how different the reaction is in the LLM and generative AI case when compared to "classical" bugs in cases where there's a clear bug. ...`
//   },
//   {
//     title: 'Writing a Unix clone in about a month',
//     url: 'https://drewdevault.com/2024/05/24/2024-05-24-Bunnix.html',
//     date: 2024-05-24T00:00:00.000Z,
//     source: {
//       url: 'https://drewdevault.com/blog/index.xml',
//       title: 'Drew DeVault'
//     },
//     preview: 'I needed a bit of a break from “real work” recently, so I started a new programming project that was low-stakes and purely recreational. On April 21st, I set out to see how much of a Unix-like operating system for x86_64 targets that I could put together in about a month. The result is Bunnix. Not i...'
//   },
//   {
//     title: 'The Web Component Success Story',
//     url: 'https://jakelazaroff.com/words/the-web-component-success-story/',
//     date: 2024-01-29T00:00:00.000Z,
//     source: { url: 'https://jakelazaroff.com/rss.xml', title: 'Jake Lazaroff' },
//     preview: "Web components won't take web development by storm, or show us the One True Way to build websites. What they will do is let us collectively build a rich ecosystem of dynamic components that work with any web stack."
//   }
// ]
```

## Configuration

`webring` is configured by passing in a `Configuration` object into the `run` method.

All possible configuration values can be seen by looking at the [`typedoc` site](https://shepherdjerred.github.io/webring/types/Configuration.html).

## Example

An example of using this project with Astro is located in `example`. The relevant file is [`src/pages/blog/[...slug].astro`](https://github.com/shepherdjerred/webring/blob/971a77ecd0c612850faeb9d16f7775d3e7ca7253/example/src/pages/blog/%5B...slug%5D.astro#L18).

```typescript
---
import { type CollectionEntry, getCollection } from "astro:content";
import BlogPost from "../../layouts/BlogPost.astro";
import { type Configuration, type Result, run } from "webring";

export async function getStaticPaths() {
  const posts = await getCollection("blog");
  return posts.map((post) => ({
    params: { slug: post.slug },
    props: post,
  }));
}
type Props = CollectionEntry<"blog">;

const post = Astro.props;
const { Content } = await post.render();

export const config: Configuration = {
  sources: [
    {
      url: "https://drewdevault.com/blog/index.xml",
      title: "Drew DeVault",
    },
    {
      url: "https://danluu.com/atom.xml",
      title: "Dan Luu",
    },
    {
      url: "https://jakelazaroff.com/rss.xml",
      title: "Jake Lazaroff",
    },
  ],
  number: 3,
  truncate: 300,
  cache: {
    cache_file: "webring.json",
    cache_duration_minutes: 60,
  },
};

export const result: Result = await run(config);
---

<BlogPost {...post.data}>
  <Content />
  <h2>Posts from blogs I read</h2>
  <ul>
    {
      result.map((post) => (
        <li>
          <a href={post.url}>{post.title}</a>
        </li>
      ))
    }
  </ul>
</BlogPost>
```

## Inspiration

- https://github.com/lukehsiao/openring-rs
- https://git.sr.ht/~sircmpwn/openring
