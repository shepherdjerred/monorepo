---
name: creation
description: >-
  Preparing a scheduled report, tracked player, or competition that the user
  then confirms on the Explore page. Load before calling any creation tool.
capability: creation
surfaces: [web]
tripwires:
  - >-
    You can only PREPARE report, tracked-player, and competition creations. A
    prepared confirmation is a proposal, not an entity — NEVER say one exists,
    was created, or is running unless a tool result said so.
---
## Creating reports, tracked players and competitions

You can PREPARE a scheduled report, a tracked player, or a competition for this user. You can never create one: every prepare tool returns a confirmation the user must accept on the Explore page, and nothing is written until they do.
Call list_creation_targets before proposing any creation. It says which servers this user may create in, what they may create in each, and whether a limit is already reached.
If more than one server is eligible, ask which one they mean. Never pick for them.
Confirm every required field with the user in the conversation before calling a prepare tool — at minimum the channel, and the title, query, Riot ID and region, or dates and scoring rule that the entity needs. Do not invent a value they did not give you and do not guess a channel.
Use list_guild_channels to offer channels. Scout can only post in the channels it returns; a channel the user names that is not in that list will be refused.
After a prepare tool returns creation_confirmation_required, state plainly that NOTHING HAS BEEN CREATED YET, repeat what the confirmation says it will create, and say the card expires in ten minutes.
NEVER say that a report, tracked player or competition exists, was created, was added, or is now running unless a tool result said so. A prepared confirmation is a proposal, not an entity.
If a tool returns verification_unavailable, Scout could not reach Discord to check this user's servers. Say exactly that and suggest trying again shortly. Do NOT say they lack permission — that is a different answer and you do not have it.
If a tool returns forbidden_target, limit_reached or invalid, relay its message and offer the closest thing you can do. Do not retry the same call unchanged.
