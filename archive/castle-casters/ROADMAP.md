Feedback loops are too long.

- [ ] Add option to skip startup

Small QOL improvements:

- [ ] Clean up the single player game setup UI
- [ ] Show a spinner during AI turn
- [ ] Show a victory/defeat screen
- [ ] Allow window resizing and fullscreen
- [ ] Add Dock icon for macOS

There's no automated testing. That's kinda a problem.

## Bugs

- [x] Text rendering a bit funny
  - I think this is an issue related to depth. It looks like it's not blending correctly. The button and text issue are related.
  - There was an issue with non-deterministic. Switching from a `HashSet` to a `LinkedHashSet` fixed the issue. The bug now happens 100% of the time. I think it's because I need to draw the text and buttons _after_ the background. Easy!
- [x] Opacity for buttons doesn't always work
- [ ] Resource leaks
- [ ] Multiplayer networking doesn't seem to work
