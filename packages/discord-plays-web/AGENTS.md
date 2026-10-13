# Discord Plays web constraints

Shared browser code for the Pokémon and Mario Kart web UIs. `README.md` owns
the module reference.

- Browser-only: no Node, Bun, or server imports. The backend half belongs in
  `@shepherdjerred/discord-plays-core`.
- Behaviour, not looks. Components here are unstyled or take class names; each
  game owns its theme, layout, and game-specific panels.
- Do not depend on either game. Game-specific schemas, keymaps, and policies
  come in as parameters.
- A change here must be verified against both frontends.
