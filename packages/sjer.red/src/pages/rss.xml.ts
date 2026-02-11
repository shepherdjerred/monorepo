import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import sanitizeHtml from "sanitize-html";
import MarkdownIt from "markdown-it";
import type { APIContext } from "astro";
const parser = new MarkdownIt();

export async function GET(context: APIContext) {
  const blog = await getCollection("blog");
  const til = await getCollection("til");

  if (context.site === undefined) {
    throw new Error("site is undefined");
  }

  return rss({
    title: "Jerred's Blog",
    description: "My personal blog",
    site: context.site,
    items: [...blog, ...til]
      .sort((left, right) => right.data.date.getTime() - left.data.date.getTime())
      .filter((post) => !post.data.isDraft)
      .map((post) => ({
        title: post.data.title,
        pubDate: post.data.date,
        description: post.data.description,
        link: `/blog/${post.id}/`,
        content: sanitizeHtml(parser.render(post.body ?? "")),
      })),
    stylesheet: "/rss/styles.xsl",
  });
}
