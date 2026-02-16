import { run } from "webring";
import { type Configuration, type Result } from "webring";

export async function getPosts(_date: Date): Promise<Result> {
  const config: Configuration = {
    // TODO: convert this to OPML so that I can import/export this with RSS readers
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
      {
        url: "https://awesomekling.github.io/feed.xml",
        title: "Andreas Kling",
      },
      {
        url: "https://xeiaso.net/blog.rss",
        title: "Xe Iaso",
      },
      {
        url: "https://ciechanow.ski/atom.xml",
        title: "Bartosz Ciechanowski",
      },
      {
        url: "https://explained-from-first-principles.com/feed.xml",
        title: "Explained From First Principles",
      },
      // {
      //   url: "http://www.aaronsw.com/2002/feeds/pgessays.rss",
      //   title: "Paul Graham",
      // },
      {
        url: "https://samwho.dev/rss.xml",
        title: "Sam Rose",
      },
      // {
      //   url: "https://rachelbythebay.com/w/atom.xml",
      //   title: "Rachel Kroll",
      // },
      {
        url: "https://brr.fyi/feed.xml",
        title: "brr.fyi",
      },
      {
        url: "https://ludic.mataroa.blog/rss/",
        title: "Ludicity",
      },
      {
        url: "https://fasterthanli.me/index.xml",
        title: "fasterthanlime",
      },
      {
        url: "https://www.joelonsoftware.com/feed/",
        title: "Joel Spolsky",
      },
      {
        url: "https://www.kalzumeus.com/feed/articles/",
        title: "Patrick McKenzie",
      },
      {
        url: "https://www.henrikkarlsson.xyz/feed",
        title: "Henrik Karlsson",
      },
      {
        url: "https://norvig.com/rss-feed.xml",
        title: "Peter Norvig",
      },
      {
        url: "https://simonwillison.net/atom/entries/",
        title: "Simon Willison",
      },
      {
        url: "https://eli.thegreenplace.net/feeds/all.atom.xml",
        title: "Eli Bendersky",
      },
      {
        url: "https://yosefk.com/blog/feed",
        title: "Yossi Kreinin",
      },
      {
        url: "https://jvns.ca/atom.xml",
        title: "Julia Evans",
      },
      {
        url: "https://sinja.io/rss",
        title: "Oleh",
      },
      {
        url: "https://eclecticlight.co/feed/",
        title: "The Eclectic Light Company",
      },
      {
        url: "https://jmw.sh/blog/index.xml",
        title: "Jacob Woliver",
      },
      {
        url: "https://www.avabear.xyz/feed",
        title: "bookbear express",
      },
      {
        url: "https://krebsonsecurity.com/feed/",
        title: "Krebs on Security",
      },
      {
        url: "https://www.seangoedecke.com/rss.xml",
        title: "Sean Goedecke",
      },
    ],
    number: 3,
    truncate: 300,
    cache: {
      cache_file: ".cache/webring.json",
      cache_duration_minutes: 12 * 60,
    },
  };

  // modify the config to only get posts before the given date
  config.sources = config.sources.map((source) => ({
    ...source,
    filter: (_preview) => {
      return true;
    },
  }));

  return await run({
    ...config,
  });
}
