import type { DeclaredFeed } from "@shepherdjerred/feeds/shared/contract.ts";

type FeedExtras = Pick<DeclaredFeed, "description" | "hidden" | "autoRead">;

function essayBlog(
  title: string,
  url: string,
  htmlUrl: string,
  extra?: FeedExtras,
): DeclaredFeed {
  return { category: "Essays & Personal Blogs", title, url, htmlUrl, ...extra };
}

const LUDICITY_DESCRIPTION =
  "<blockquote>\r\n\r\n\"While I'm deeply sympathetic, the author should be discussing their issues with a therapist rather than spreading this on the internet.\"\r\n</blockquote>\r\n\r\nI'm also trying out Unoffice Hours, where anyone can book time with me.\r\n<ol>\r\n<li>If you're just a reader that wants to chat about whatever, you can grab me at this link. Don't pick crazy hours for yourself — you'll oversleep and have booked my calendar for no reason!</li>\r\n<li>If you want to chat and might buy consulting one day, you can use this link, which is exactly the same as the previous link but with more availability. It's just a social call, so it's honour system rules on not using it to sneak extra time from my calendar.</li>\r\n<li>If you live in Melbourne, this final link straight-up arranges an in-person meeting at a nice coffee place.</li>\r\n</ol>\r\n\r\nI read all mail without exception, and love getting it. I may not respond, but I'll always read! You can reach me at: ludicity.hackernews@gmail.com.\r\n\r\nMy podcast, \"Does A Frog Have Scorpion Nature\", where I talk to people I like, and sometimes find blog post inspiration.\r\n\r\nYou can also catch me on Mastodon.\r\n\r\nLiberapay | Patreon to support me writing taking time off to write amidst the difficulty of launching a business.\r\n\r\nI looked at some code in late 2024 which was so hideous that I rage-quit my job on the spot and started an IT consultancy, Hermit Tech. We sell the voice of reason to companies, especially on data-related issues. You can always book time with us to talk about your problems! I've worked with some readers before and everyone had a good time. We have some bold, innovative technology, such as not lying, explaining things clearly, and listening to people.";

export const ESSAY_BLOG_FEEDS: readonly DeclaredFeed[] = [
  essayBlog(
    "Andreas Kling",
    "https://awesomekling.github.io/feed.xml",
    "https://awesomekling.github.io/",
    { description: "I like computers!" },
  ),
  essayBlog(
    "Bartosz Ciechanowski",
    "https://ciechanow.ski/atom.xml",
    "https://ciechanow.ski/",
    { description: "Recent content on Bartosz Ciechanowski" },
  ),
  essayBlog(
    "bookbear express",
    "https://www.avabear.xyz/feed",
    "https://www.avabear.xyz/",
    { description: "help-self" },
  ),
  essayBlog(
    "Brandur Leach",
    "https://brandur.org/articles.atom",
    "https://brandur.org/",
    {
      description: "Brandur Leach's essays on software, systems, and databases",
    },
  ),
  essayBlog("brr", "https://brr.fyi/feed.xml", "https://brr.fyi/", {
    description:
      "Observations on US Antarctic infrastructure. Anecdotes from daily life for USAP support staff. Focused on McMurdo Station and Amundsen-Scott South Pole Station.",
  }),
  essayBlog("Dan Luu", "https://danluu.com/atom.xml", "https://danluu.com/", {
    description: "Dan Luu's articles on systems, hardware, and engineering",
  }),
  essayBlog(
    "Drew DeVault",
    "https://drewdevault.com/blog/index.xml",
    "https://drewdevault.com/",
    { description: "Drew DeVault's blog on systems and free software" },
  ),
  essayBlog(
    "Eli Bendersky",
    "https://eli.thegreenplace.net/feeds/all.atom.xml",
    "https://eli.thegreenplace.net/",
  ),
  essayBlog(
    "Escaping Flatland",
    "https://www.henrikkarlsson.xyz/feed",
    "https://www.henrikkarlsson.xyz/",
    {
      description:
        "I write essays about relationships, thought, and agency. I hang with our kids. We live on a pine covered island in the Baltic Sea. That's about it.",
    },
  ),
  essayBlog(
    "Explained from First Principles",
    "https://explained-from-first-principles.com/feed.xml",
    "https://explained-from-first-principles.com/",
    {
      description:
        "Explained from First Principles is a technology, science, and philosophy blog for curious people.",
    },
  ),
  essayBlog(
    "Factorio Blog",
    "https://www.factorio.com/blog/rss",
    "https://www.factorio.com/",
  ),
  essayBlog(
    "fasterthanli.me",
    "https://fasterthanli.me/index.xml",
    "https://fasterthanli.me/",
    { description: "amos likes to tinker" },
  ),
  essayBlog(
    "jakelazaroff.com",
    "https://jakelazaroff.com/rss.xml",
    "https://jakelazaroff.com/",
    {
      description:
        "Just a programmer trying to make a home for myself on the WWW.",
    },
  ),
  essayBlog("Jerred's Blog", "https://sjer.red/rss.xml", "https://sjer.red/", {
    description: "My personal blog",
  }),
  essayBlog(
    "Joel on Software",
    "https://www.joelonsoftware.com/feed/",
    "https://www.joelonsoftware.com/",
  ),
  essayBlog("Julia Evans", "https://jvns.ca/atom.xml", "http://jvns.ca/"),
  essayBlog(
    "Kalzumeus Software",
    "https://www.kalzumeus.com/feed/articles/",
    "https://www.kalzumeus.com/",
    {
      description:
        "Patrick McKenzie (patio11) blogs on software development, marketing, and general business topics",
    },
  ),
  essayBlog(
    "Ludicity",
    "https://ludic.mataroa.blog/rss/",
    "https://ludic.mataroa.blog/",
    { description: LUDICITY_DESCRIPTION },
  ),
  essayBlog(
    "Mitchell Hashimoto",
    "https://mitchellh.com/feed.xml",
    "https://mitchellh.com/",
    { description: "Mitchell Hashimoto's personal blog" },
  ),
  essayBlog("OlegWock", "https://sinja.io/rss", "https://sinja.io/", {
    description: "OlegWock blog",
  }),
  essayBlog(
    "Peter Norvig",
    "https://www.norvig.com/rss-feed.xml",
    "http://www.norvig.com/",
    { description: "Articles by Peter Norvig" },
  ),
  essayBlog("samwho.dev", "https://samwho.dev/rss.xml", "https://samwho.dev/", {
    description: "Personal website of Sam Rose.",
  }),
  essayBlog(
    "Sean Goedecke",
    "https://www.seangoedecke.com/rss.xml",
    "https://seangoedecke.com/",
    { description: "Sean Goedecke's personal blog" },
  ),
  essayBlog(
    "Simon Willison",
    "https://simonwillison.net/atom/entries/",
    "http://simonwillison.net/",
  ),
  essayBlog(
    "Useful Fictions",
    "https://usefulfictions.substack.com/feed",
    "https://usefulfictions.substack.com/",
    { description: "all models are wrong, but some are useful" },
  ),
];
