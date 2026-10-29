---
title: Camps and towns
description: Claim a place to build, invite friends, and grow a camp into a town.
---

A camp is a free first home for you and your friends. It protects land in chunks: each chunk is 16 by 16 blocks, from the bottom to the top of the world. Press F3 and G in Java Edition to see chunk borders.

## Start a camp

Stand where you want to build, run `/camp create`, and then `/claim`. A camp may also start automatically when you settle: placing a bed, or a chest and a door, can claim the chunk and set your default home if you do not have one. Placing 24 solid blocks in one chunk and staying nearby for five minutes can also start a camp. Read `/camp help` in game for details.

For example, stand in the chunk containing your house and claim it, then move across a chunk edge and claim the neighboring chunk for a garden. Use `/claim info` in either chunk to check what you claimed.

A camp can hold up to 16 chunks in one connected shape. To add a chunk, stand in it and use `/claim`; it must share an edge with your existing land. Corners do not count. `/unclaim` releases the chunk you stand in, but cannot split the camp into separate pieces.

The owner can invite someone with `/camp invite <player>`. The invited player joins with `/camp join <owner>`. A camp holds up to eight people, including its owner. Any member can claim land. Use `/claim personal` to reserve a chunk for yourself, or `/claim shared` to share it with the camp. If you leave, your personal chunks return to the camp.

For removing members and choosing who can use a chunk, see [Sharing a camp](/homes/sharing-a-camp/).

Outsiders cannot build, open containers, or harm animals on camp land. New containers have their own locks. PvP is on by default. If no member comes online for 90 days, the camp and its claims are removed; blocks and locks remain. A warning appears during the last 14 days.

<div><storm-media data-manifest="/media/camp-overview/media.json"><figure><img alt="Your camp reports its members, claimed chunks, and activity window." src="/media/camp-overview/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Your camp reports its members, claimed chunks, and activity window.</figcaption></figure></storm-media></div>
<p><a href="/media/camp-overview/annotated.webp" download>Download annotated image</a></p>

## Grow into a town

Once the owner has Governor I, `/camp graduate <name>` turns the camp into a named town, keeping its chunks and members. The camp's inactivity clock stops. You can train Governor with a trainer or `/perks`.

Use `/town list` to see towns and `/town info` for information about yours. A town owner can invite players with `/town invite <player>`; invitees use `/town accept <town>` or `/town deny <town>`. Towns also have a shared treasury: `/town balance`, `/town deposit <amount>`, and, for owners and assistants, `/town withdraw <amount>`.

## Manage a town

Members can leave with `/town leave`. Owners and assistants can remove someone below their rank with `/town kick <player>`. The owner can make a member an assistant with `/town promote <player>` or return an assistant to member with `/town demote <player>`. Owners cannot leave until they transfer ownership or delete the town. To transfer it, use `/town transfer <player>` and then `/town transfer confirm` within 60 seconds. The successor must be online, have Governor I, and have a high enough Governor level for the town's current land.

<div><storm-media data-manifest="/media/town-transfer-confirmation/media.json"><figure><img alt="Ownership handover requires a separate confirmation before the owner changes." src="/media/town-transfer-confirmation/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Ownership handover requires a separate confirmation before the owner changes.</figcaption></figure></storm-media></div>
<p><a href="/media/town-transfer-confirmation/annotated.webp" download>Download annotated image</a></p>

See [Town roles](/homes/town-roles/) for the permissions each role receives.

Expand with `/claim`; owners and assistants can release land with `/unclaim`. Town land must stay connected, and new claims must keep a two-chunk buffer from other towns. The owner's Governor level determines the town's limit: Governor I through V allow 24, 32, 48, 64, and 80 chunks respectively.

Use `/claim info` to inspect the chunk you stand in. [Claim settings](/homes/claim-settings/) explains how to change access and protection for each chunk.

Claims and locks work together. Sharing land does not automatically give everyone access to a locked chest. See [Locks](/homes/locks/) to choose who can open it.
