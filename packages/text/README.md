# Text

`@shepherdjerred/text` shortens and splits user-facing text without breaking
characters. JavaScript strings are UTF-16, so `slice(0, n)` can cut an emoji in
half and leave a lone surrogate (`isWellFormed() === false`), or cut through a
flag, skin-tone modifier, or ZWJ sequence. These helpers cut only on grapheme
cluster boundaries using the built-in `Intl.Segmenter`.

```ts
import {
  chunkGraphemes,
  firstGraphemes,
  graphemePrefix,
  truncateGraphemes,
} from "@shepherdjerred/text";

truncateGraphemes(title, 100); // ≤ 100 units, "…" appended only when cut
truncateGraphemes(body, 1024, "..."); // custom indicator, still ≤ 1024
graphemePrefix(answer, 4000); // hard cap with no indicator
firstGraphemes(displayName, 1); // avatar initial: "😀" not "\ud83d"
chunkGraphemes(message, 1900); // message parts, joined they equal the input
```

Budgets are UTF-16 code units (`String#length`), matching JavaScript length
checks and Zod `.max()`. Discord measures its limits in code points, which is
never larger, so a code-unit budget always fits.

`chunkGraphemes` splits a single cluster longer than a chunk (for example
zalgo text) between code points, so untrusted input never makes it throw.
Invalid budgets and an indicator longer than the budget throw `RangeError`.

Published npm packages (`webring`, `astro-opengraph-images`) cannot depend on
this private workspace package and keep their own equivalent helper.
