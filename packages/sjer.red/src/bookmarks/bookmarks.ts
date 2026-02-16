import * as jsdom from "jsdom";
import { readFile, writeFile } from "fs/promises";
import { z } from "zod";

export const links = [
  "https://vitalik.eth.limo/general/2024/01/31/end.html",
  "https://qsantos.fr/2024/01/04/dynamic-programming-is-not-black-magic/",
  "https://www.experimental-history.com/p/so-you-wanna-de-bog-yourself",
  "https://sashachapin.substack.com/p/some-painful-questions-we-ask-ourselves",
  "https://www.gregegan.net/FOUNDATIONS/",
  "https://danluu.com/culture/",
  "https://protohackers.com/",
  "https://danluu.com/startup-tradeoffs/",
  "https://research.swtch.com/testing",
  "https://bbycroft.net/llm",
  "https://course.fast.ai/",
  "https://skip.house/blog/nix-in-practice/",
  "https://www.feynmanlectures.caltech.edu/",
  "https://ocw.mit.edu/courses/18-s097-applied-category-theory-january-iap-2019/",
  "https://d3s.mff.cuni.cz/teaching/nprg077/",
  "https://martin.kleppmann.com/2011/03/07/accounting-for-computer-scientists.html",
  "https://www.encona.com/posts/debits-and-credits",
  "https://www.recurse.com/",
  "https://www.inkandswitch.com/local-first/",
  "https://math.ucr.edu/home/baez/act_course/",
  "http://indiehackers.com",
  "https://practicaltypography.com/",
  "https://www.joshwcomeau.com/react/server-components/",
  "https://exist.io/",
  "https://www.susanrigetti.com/physics",
  "https://www.testingjavascript.com/",
  "https://xata.io/blog/postgres-full-text-search-engine",
  "https://weaknuclearforce.wordpress.com/",
  "https://notes.eatonphil.com/2023-05-25-raft.html",
  "https://drewdevault.com/2023/05/01/2023-05-01-Burnout.html",
  "https://www.3blue1brown.com/",
  "https://ciechanow.ski/bicycle/",
  "https://www.cs.cornell.edu/courses/cs6120/2020fa/self-guided/",
  "https://fly.io/dist-sys/",
  "https://explained-from-first-principles.com/email/",
  "https://tynan.com/letstalk/",
  "https://stevens.netmeister.org/631/",
  "https://www.experimental-history.com/p/the-five-tools-of-hedonic-design",
  "https://diataxis.fr/",
  "https://sashachapin.substack.com/p/making-normal-conversations-better",
  "https://www.experimental-history.com/p/good-conversations-have-lots-of-doorknobs",
  "https://danluu.com/wat/",
  "https://danluu.com/cocktail-ideas/",
  "https://gmays.com/how-im-relearning-math-as-an-adult/",
  "https://www.homeautomationguy.io/",
  "https://awesomekling.github.io/Excellence-is-a-habit-but-so-is-failure/",
  "https://diary.geekodour.org/",
  "https://www.morling.dev/blog/the-code-review-pyramid/",
  "https://hyperboleandahalf.blogspot.com/2013/05/depression-part-two.html",
  "https://ludic.mataroa.blog/blog/your-organization-probably-doesnt-want-to-improve-things/",
  "https://milan.cvitkovic.net/writing/things_youre_allowed_to_do/",
  "https://parhelia.conorbarnes.com/p/the-placeholder-girlfriend",
  "https://usefulfictions.substack.com/p/how-to-be-more-agentic",
  "https://sashachapin.substack.com/p/things-you-learn-dating-cate-hall",
  "https://www.epicweb.dev/fully-typed-web-apps",
  "https://vinnie.dev/using-zod-at-the-edge-of-our-typescript-type-system/",
  "https://furia.com",
  "https://fly.io/blog/",
  "https://tonsky.me",
  "https://explained-from-first-principles.com",
  "http://wiki.c2.com",
  "https://samwho.dev",
  "https://paulgraham.com/articles.html",
  "https://www.ben-evans.com",
  "https://awesomekling.github.io",
  "https://drewdevault.com",
  "https://xeiaso.net/blog/",
  "https://www.joshwcomeau.com",
  "https://sive.rs",
  "https://jakelazaroff.com",
  "https://danluu.com/p95-skill/",
  "https://theluddite.org/",
  "https://aphyr.com/",
  "https://gwern.net/",
  "https://www.writingruxandrabio.com/p/the-weird-nerd-comes-with-trade-offs",
  "https://www.autodidacts.io/holistic-perfectionism/",
  "https://realmensch.org/2017/08/25/the-parable-of-the-two-programmers/",
  "https://manuel.kiessling.net/2011/04/07/why-developing-without-tests-is-like-driving-a-car-without-brakes-2/",
  "https://experimentalhistory.substack.com/p/why-arent-smart-people-happier",
  "https://danilafe.com/blog/blog_microfeatures/",
  "https://ludic.mataroa.blog/blog/on-burnout-mental-health-and-not-being-okay/",
  "https://ludic.mataroa.blog/blog/the-complex-problem-of-lying-for-jobs/",
  "https://www.kalzumeus.com/2011/10/28/dont-call-yourself-a-programmer/",
  "https://www.kalzumeus.com/2012/01/23/salary-negotiation/",
  "https://ludic.mataroa.blog/blog/the-corporate-facade-is-more-complicated-than-i-thought/",
  "https://staffeng.com/",
  "https://yosefk.com/blog/advantages-of-incompetent-management.html",
  "https://lethain.com/magnitudes-of-exploration/",
  "https://cse.buffalo.edu/~rapaport/howtostudy.html",
  "https://www.stevenbuccini.com/8-hard-truths-on-getting-laid-off",
  "https://jepsen.io/consistency",
  "https://www.kitchensoap.com/2012/10/25/on-being-a-senior-engineer/",
  "https://www.alexreichert.com/blog/finishing",
  "https://yosefk.com/blog/people-can-read-their-managers-mind.html",
  "https://www.aleksandrhovhannisyan.com/blog/62-5-percent-font-size-trick/",
  "https://typescale.com",
  "https://sinja.io/blog/web-typography-quick-guide",
  "https://sohl-dickstein.github.io/2022/11/06/strong-Goodhart.html",
  "https://www.seangoedecke.com/how-to-ship/",
  "https://quarter--mile.com/You-Could-Just-Choose-Optimism",
];

const file = "src/bookmarks/bookmarks.json";

try {
  await readFile(file, "utf-8");
} catch (_e) {
  await writeFile(file, "{}");
}

export const BookmarkSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  added: z.coerce.date().optional(),
  commentary: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type Bookmark = z.infer<typeof BookmarkSchema>;

export const BookmarksSchema = z.record(z.string().url(), BookmarkSchema);

export type Bookmarks = z.infer<typeof BookmarksSchema>;

const bookmarksFromFile = BookmarksSchema.parse(JSON.parse(await readFile(file, "utf-8")));

const results = await Promise.all(
  links.map(async (link) => {
    if (bookmarksFromFile[link]) {
      return bookmarksFromFile[link];
    } else {
      console.log(`Fetching ${link}`);
      try {
        const response = await fetch(link, { redirect: "follow" });
        const text = await response.text();
        const htmlDoc = new jsdom.JSDOM(text).window.document;
        // TODO: hand this to some AI model to get a summary
        const base: z.infer<typeof BookmarkSchema> = {
          title: htmlDoc.title,
          added: new Date(),
          tags: [],
        };
        const description = htmlDoc.querySelector("meta[name=description]")?.getAttribute("content");
        if (description) {
          base.description = description;
        }
        return base;
      } catch (_e) {
        console.error(`Failed to fetch ${link}`);
        return {
          title: "Failed to fetch",
        };
      }
    }
  }),
);

export const bookmarks: Bookmarks = BookmarksSchema.parse(
  Object.assign(bookmarksFromFile, Object.fromEntries(links.map((link, i) => [link, results[i]]))),
);

await writeFile(file, JSON.stringify(bookmarks, null, 2));
