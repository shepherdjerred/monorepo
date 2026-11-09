---
title: Managing locks
description: Choose who can use a lock and control automatic locking.
---

Look at a locked block or object to inspect or change its access. Land rules still apply separately; see [Sharing land](/homes/sharing-land/).

## Share a lock

Use `/lock info` to inspect its owner, access, and options. `/lock trust <player>` allows use, while `/lock trust <player> manage` also allows management and breaking. `/lock untrust <player>` removes the grant. The owner can use `/lock share on` to let town members use the lock, and `/lock share off` to stop sharing; town sharing does not let them break it.

![Lock information shows the demonstration container's owner, trusted players, and access options.](/screenshots/lock-info.webp)

The message identifies the container's owner and describes its access and options. A container held by staff shows staff custody instead.

On a claim only you use, redstone always works on your locked dispensers, droppers, and crafters. That means a camp or town where you are the only member, nobody else is trusted on the claim, and its switches and building are not public; there, nobody else can flip your levers. Keep the controls on that claim, or on another claim that only you use: power from a lever or wire anywhere else does not count, including a claim of the same town or camp whose switches are public. Triggers you build yourself still work for anyone who can reach them, as in vanilla: if you wire a trapped chest with a lock others can open, a sculk sensor, or a lectern to a machine, other players can run it through that trigger. Anywhere else, including a shared town and the wilderness, other people could flip your lever and collect what the machine drops, so redstone stays off until you use `/lock redstone on`. `/lock redstone off` turns that choice off again, and `/lock info` shows whether redstone works where the machine stands. Other players can only wire a locked machine if they can open it. To let items move between containers owned by different players, or into a container you left unlocked, use `/lock hopper on` on each locked container involved. Use `/lock hopperin on` or `/lock hopperout on` to allow only transfers in or out, respectively.

<div><storm-media data-manifest="/media/lock-trusted/media.json"><figure><img alt="Lock information lists MapleFox with manage access" src="/media/lock-trusted/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>Manage access lets a trusted player open and break the locked container.</figcaption></figure></storm-media></div>
<p><a href="/media/lock-trusted/annotated.webp" download>Download annotated image</a></p>

## Choose a lock type

The owner can change the lock by looking at it and using one of these commands:

| Command                     | Access for other players                                        |
| --------------------------- | --------------------------------------------------------------- |
| `/lock private`             | Only trusted players and any shared town can use it.            |
| `/lock public`              | Anyone can use it; it remains locked against takeover.          |
| `/lock donation`            | Players can put items in, but cannot take them out.             |
| `/lock supply`              | Players can take items out, but cannot put them in.             |
| `/lock display`             | Players can look, but cannot move items.                        |
| `/lock password <password>` | Players who enter the password during their session can use it. |

To open a password lock, interact with it and type the password in chat when prompted. The response is not broadcast, and access lasts until you log out.

<details><summary>Example messages for each lock type</summary>

<div><storm-media data-manifest="/media/lock-private/media.json"><figure><img alt="A private lock names its owner and blocks untrusted players." src="/media/lock-private/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>A private lock names its owner and blocks untrusted players.</figcaption></figure></storm-media></div>
<p><a href="/media/lock-private/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/lock-public/media.json"><figure><img alt="A public lock allows anyone to use the container." src="/media/lock-public/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>A public lock allows anyone to use the container.</figcaption></figure></storm-media></div>
<p><a href="/media/lock-public/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/lock-donation/media.json"><figure><img alt="A donation lock lets visitors add items without taking them." src="/media/lock-donation/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>A donation lock lets visitors add items without taking them.</figcaption></figure></storm-media></div>
<p><a href="/media/lock-donation/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/lock-supply/media.json"><figure><img alt="A supply lock lets visitors take items without adding them." src="/media/lock-supply/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>A supply lock lets visitors take items without adding them.</figcaption></figure></storm-media></div>
<p><a href="/media/lock-supply/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/lock-display/media.json"><figure><img alt="A display lock lets visitors look without moving items." src="/media/lock-display/original.webp" width="1280" height="720" loading="lazy" decoding="async"><figcaption>A display lock lets visitors look without moving items.</figcaption></figure></storm-media></div>
<p><a href="/media/lock-display/annotated.webp" download>Download annotated image</a></p>

</details>

## Change your lock modes

Each command toggles its mode and stays in effect until toggled again:

- `/lock mode nolock` stops new containers from locking automatically.
- `/lock mode persist` copies the targeted lock's type, options, and access to subsequent locks.
- `/lock mode droptransfer` puts dropped items into the container you are looking at.
- `/lock mode quiet` hides successful lock command messages.

See [Locks](/homes/locks/) for the basics and the lock limit.

## If someone cannot open a container

First check `/claim info` at the container: the player needs access to the land. Then look at the container and use `/lock info`: the owner can grant access or change the lock type. Sharing a claim does not automatically share its locks. If a hopper cannot move items, check the transfer flags on both containers.
