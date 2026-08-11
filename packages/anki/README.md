# anki

Anki flashcard decks authored as Markdown and compiled to `.apkg` files with
[mdanki](https://github.com/ashlinchak/mdanki). Each `## heading` is a card
front; the body below it is the back.

## Decks

| File                                        | Deck                                                 |
| ------------------------------------------- | ---------------------------------------------------- |
| `book_ostep.md`                             | Operating Systems: Three Easy Pieces (OSTEP)         |
| `book_high_performance_web_applications.md` | Book: High Performance Web Applications              |
| `bytes.md`                                  | Byte-size / powers-of-two arithmetic                 |
| `interview.md`                              | Miscellaneous interview prep (algorithms, JS idioms) |

## Generating decks

```bash
cd packages/anki
mise run dev   # runs: bun ../../scripts/generate-anki.ts
```

The generator (`scripts/generate-anki.ts` at the repo root) runs
`bunx mdanki <deck>.md <deck>.apkg --config settings.json` for each deck.
`settings.json` holds the shared card template: question/answer HTML formats
and the card CSS.

### sql.js memory-growth swap

Before invoking mdanki, the generator overwrites
`node_modules/sql.js/js/sql.js` with the bundled `sql-memory-growth.js` build.
The default sql.js build has a fixed Emscripten heap and aborts on larger
decks; the memory-growth build allows the heap to grow. Do not remove that
copy step.
