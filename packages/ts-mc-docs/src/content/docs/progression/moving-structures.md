---
title: Elevators and moving structures
description: Build lifts, bridges, doors and gates with signs.
---

Mechanic II can build these structures. Anyone with interaction permission can use them. Write each tag on line 2 of its sign.

## Elevator

Place signs in the same vertical column, no more than 128 blocks apart. Use `[Lift Up]` to travel upward, `[Lift Down]` to travel downward, or `[Lift]` for a stop. Right-click the appropriate sign to travel to the next stop in that direction.

<div><storm-media data-manifest="/media/elevator-layout/media.json"><figure><img alt="Two vertically aligned lift signs with a safe platform at each stop" src="/media/elevator-layout/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Align the signs vertically and leave room to stand at each floor.</figcaption></figure></storm-media></div>
<p><a href="/media/elevator-layout/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/elevator-travel/media.json"><figure><video controls muted playsinline preload="metadata" poster="/media/elevator-travel/poster.webp" aria-label="Using the elevator to travel up and return to ground level" src="/media/elevator-travel/clip.mp4" width="1280" height="720"></video><figcaption>The signs move the player between aligned stops.</figcaption></figure></storm-media></div>
<p><a href="/media/elevator-travel/annotated.mp4" download>Download annotated video</a></p>

## Bridge

1. Place two standing signs six blocks apart in a straight line, facing away from each other.
2. Put an oak plank directly below each sign and write `[Bridge]` on line 2 of each. The second sign links the ends.
3. If the five spaces between the end planks are empty, right-click a sign while holding five oak planks to supply the moving section.
4. Right-click with an empty hand to toggle the walkway. Add matching planks beside both ends to widen it by up to two blocks on each side.

<div><storm-media data-manifest="/media/bridge-retracted/media.json"><figure><img alt="The moving bridge is retracted, leaving a gap between its matching ends" src="/media/bridge-retracted/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Matching Bridge signs control the gap between the fixed ends.</figcaption></figure></storm-media></div>
<p><a href="/media/bridge-retracted/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/bridge-extended/media.json"><figure><img alt="Bridge planks span the five spaces between its fixed ends" src="/media/bridge-extended/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Activating either sign extends the walkway across the gap.</figcaption></figure></storm-media></div>
<p><a href="/media/bridge-extended/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/moving-bridge/media.json"><figure><video controls muted playsinline preload="metadata" poster="/media/moving-bridge/poster.webp" aria-label="A sign-controlled bridge opens and closes over a trench" src="/media/moving-bridge/clip.mp4" width="1280" height="720"></video><figcaption>Right-click either Bridge sign to toggle the moving section.</figcaption></figure></storm-media></div>
<p><a href="/media/moving-bridge/annotated.mp4" download>Download annotated video</a></p>

The ends must match in material and width. Bridges can extend up to 32 blocks and accept whole blocks such as planks, stone, sandstone and glass.

## Door

For a one-block-wide door, stack a `[Door Up]` sign, an oak plank, three empty spaces, another oak plank, and a `[Door Down]` sign in one vertical column. The second sign links the ends. Right-click either sign to toggle the moving section. Matching blocks can widen a door by up to two blocks on each side; its maximum length is 12 blocks.

<div><storm-media data-manifest="/media/door-closed/media.json"><figure><img alt="Oak planks fill the moving section between the fixed ends of a sign-controlled door" src="/media/door-closed/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>The closed door fills the gap between its fixed end blocks.</figcaption></figure></storm-media></div>
<p><a href="/media/door-closed/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/door-open/media.json"><figure><img alt="The three moving oak planks are removed, leaving the fixed end blocks in place" src="/media/door-open/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Opening stores the moving blocks for the next closing.</figcaption></figure></storm-media></div>
<p><a href="/media/door-open/annotated.webp" download>Download annotated image</a></p>

## Gate

Build a three-wide wall of oak fences six blocks high on solid ground. Place a sign within three blocks of the fence columns and write `[Gate]` on line 2. Right-click to raise or lower the gate. The top fence of each column remains in place. Gates support up to 16 columns and 12 blocks in height, using fences, iron bars or glass panes.

<div><storm-media data-manifest="/media/gate-closed/media.json"><figure><img alt="A closed three-wide oak fence gate between stone posts" src="/media/gate-closed/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Each fence column reaches the ground when the gate is closed.</figcaption></figure></storm-media></div>
<p><a href="/media/gate-closed/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/gate-open/media.json"><figure><img alt="The raised gate leaves an open passage while the top fence row stays in place" src="/media/gate-open/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Opening removes the lower fences and keeps the top of each column.</figcaption></figure></storm-media></div>
<p><a href="/media/gate-open/annotated.webp" download>Download annotated image</a></p>

Redstone power opens bridges, doors and gates; loss of power closes them. Leave the moving area clear, and make sure you have permission to build and interact across the structure. See [Mechanisms](/progression/mechanisms/) for more builds.

Opening a moving structure stores its removed blocks for the next closing. If a bridge or door starts empty, supply matching blocks first by right-clicking its sign while holding them.
