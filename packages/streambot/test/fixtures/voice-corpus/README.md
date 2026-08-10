# Streambot voice corpus

This directory is populated only by `bun run voice:corpus:generate`. The generated `manifest.json`
and `clips/*.dopus` files are canonical, reviewed fixtures and must be committed together. Do not
hand-edit or copy human recordings here; private holdouts stay under `.context` and use
`voice:human:evaluate`.

Generation is resumable. Replacing an existing fixture requires `--refresh`; verification and
evaluation never contact OpenAI. The production image gate intentionally fails until the complete
400-clip corpus is present and passes both native and WASM runtimes.
