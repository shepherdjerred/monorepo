---
title: Play together
description: Join shared MW2 and Black Ops sessions and verify Apple silicon Mac and Windows crossplay after setup.
---

Finish your [Windows setup](/docs/crossplay/windows/) or
[Apple silicon macOS setup](/docs/crossplay/macos/) first. Every player should
be able to open their game and load a base map before the group tries joining.
These checks still need a real Mac/Windows pair; they are not locally verified.

## Before joining

Agree on the game, mode, client, and map. Use matching game content and current
client versions. Start with a **Windows host** for private matches so Mac
hosting is a separate test. Begin with a base-game map before adding mods.

## Modern Warfare 2

Everyone runs IW4x. Agree on the complete server name and game mode, then use
the in-game server browser to join that exact server. Confirm both Mac and
Windows players appear in the same match before choosing teams.

## Black Ops I and II

Everyone uses the same Plutonium title and mode. Follow each other on the
Plutonium forums and restart the game if a newly followed friend is missing.

Use the game's joining steps for the selected mode:

- **BO1 Zombies:** [create the Zombies lobby and invite before starting](/docs/t5/#5-start-a-group-match).
- **BO1 MP:** [have the host load the private match before inviting](/docs/t5/#6-play-multiplayer), or join the same public server.
- **BO2 Zombies:** [create the custom lobby and use P/F for privacy and invitations](/docs/t6/#5-start-a-group-match).
- **BO2 MP:** [invite into the multiplayer custom lobby](/docs/t6/#6-play-multiplayer), or join the same public server.

Mac players perform these actions in the game running through CrossOver.
Test both modes independently; neither title's current Apple silicon crossplay
has been established here.

## Black Ops III

Everyone uses Steam BO3 with their platform's patch and the **same group network
password**. Set it using your platform setup page, then restart the game.
BOIII compatibility with this route remains unverified.

1. Add each other as **Steam friends**.
2. Have everyone open the same mode: **Multiplayer** or **Zombies**.
3. The host creates a private/custom lobby and invites the group through Steam or the in-game friends interface.
4. Accept the invitation and confirm both Mac and Windows players appear in the lobby.
5. Choose a base map everyone owns, start, and confirm everyone loads into the same match.

A network password isolates the group from normal public matchmaking; this is
the patch projects' friends-session route. Later, repeat with a Mac host if the
group needs Mac hosting.

For custom Zombies maps, every player must subscribe to the same Workshop map
and mods and finish downloading them first. Selecting a map as host does not
automatically install it for guests. Start with one map and matching mod versions
after the base-map session works.

## Confirm crossplay

Use at least one Apple silicon Mac and one Windows amd64 PC:

1. Confirm both players can see and interact with each other in the same map.
2. For MW2, complete an MP match.
3. For each Black Ops title, complete an MP match and separately play several Zombies rounds together.
4. Leave and rejoin once to check that joining works again.

Menu access, a solo map, and a Windows-only session are separate checks. Confirm
both modes before inviting the rest of the group. If a session fails, keep the
error text and exact game/client, macOS, CrossOver or wrapper, and patch versions
for the relevant upstream project.

If friends cannot join BO3, compare the group password, Steam friends, mode,
map, and patch versions. For Plutonium connection failures, use the game's
Windows walkthrough and [official connection guide](https://plutonium.pw/docs/custom-games/).
