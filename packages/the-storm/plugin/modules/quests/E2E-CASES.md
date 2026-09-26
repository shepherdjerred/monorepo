# Quests: real-server cases

Behaviour MockBukkit cannot exercise (runtime dialogs, scoreboard number formats, LuckPerms, the economy, Geyser). The e2e suite (`packages/the-storm/tests/e2e`) should cover these.

1. Enable with the shipped content: the log says "Loaded 24 quests and 7 board templates"; a content error (say, an unknown material) stops the plugin and lists every problem with its file and path.
2. Right-click Thomas as a new player: the dialog offers A Blacksmith's Task with Accept, "What's with all these attacks?" and Not now; the question screen has Back. Accept closes the dialog and Thomas's accept line appears in chat. On Bedrock (Geyser) the same screens appear as simple forms with at most six buttons.
3. An NPC with several quests (the Guard Captain after Ready for Battle, or Thomas with a hand-in and an offer) shows the "What can I do for you?" menu, hand-ins first.
4. Markers: `!` over every giver with an offer the player can take, none over hidden quests; `?` over Thomas once the player carries everything left to deliver, and over the Guard Captain once the kills are done. Markers are per player (a second player sees their own).
5. Hand over with a partial stack: 20 of 32 iron are taken, the chat says "Handed over 20 Iron Ingot.", the sidebar shows 20/32. The rest later completes the stage and the quest.
6. The tracking sidebar replaces the scoreboard with the tracked quest's objectives, numbers hidden; `/quests track <id>` toggles it off and restores the main scoreboard. Check it does not fight another module's scoreboard (tab list teams, if any).
7. `/quests` opens the journal dialog; its Track buttons switch the sidebar.
8. Crystal rewards arrive in the wallet with ledger reason `quest:<id>`; titles and spells appear as `thestorm.titles.<id>` / `thestorm.spells.learned.<id>` LuckPerms nodes, including for a player who logs off before LuckPerms saves.
9. Party credit: two players within 24 blocks on Ready for Battle both count a zombie one of them kills; a third player 30 blocks away does not.
10. Mine objectives: breaking a block you just placed does not count; breaking natural stone does.
11. Reach: walking into the South Entrance region completes that stage; teleporting in (not walking) also counts on the next move.
12. The South Mines spawns 3 zombies at the mines after talking to Dorran and after the hand-in; they despawn after `spawnedMobSeconds`.
13. Board: the quest-board NPC offers 3 dailies and 1 weekly; at local midnight (America/Los_Angeles) an unfinished daily is dropped with "Quest dropped" and new ones are drawn; a completed daily cannot be retaken the same day.
14. Daily Login: Anna pays 50 crystals once per local day; the 3rd claim pays the 25-crystal bonus.
15. Restart mid-quest: progress, tracked quest, board and pinned markers survive a restart (they are saved on every change).
16. `/quests admin complete <player> <quest>` pays the rewards; `reset` makes the quest offerable again; `stage` jumps; all need `thestorm.quests.admin`.
17. `/quests top` lists names (from the player directory) and quest points.
