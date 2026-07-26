#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pydantic>=2.0",
# ]
# ///
"""Validate Glitter context JSON through an independent Pydantic model."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = PACKAGE_ROOT / "data"
IDENTIFIER_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
DISCORD_ID_PATTERN = r"^\d{17,20}$"


class DocumentModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    schema_ref: str | None = Field(default=None, alias="$schema")
    schemaVersion: Literal[1]


class Person(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=IDENTIFIER_PATTERN)
    displayName: str = Field(min_length=1)
    kind: Literal["person", "group"]
    aliases: list[str]
    discordUserIds: list[str]


class PeopleDocument(DocumentModel):
    people: list[Person]

    @model_validator(mode="after")
    def validate_unique_people(self) -> PeopleDocument:
        ids: set[str] = set()
        aliases: set[str] = set()
        for person in self.people:
            if person.id in ids:
                raise ValueError(f"duplicate person id: {person.id}")
            ids.add(person.id)
            person_aliases = {
                alias.lower()
                for alias in [person.id, person.displayName, *person.aliases]
            }
            duplicate_aliases = aliases.intersection(person_aliases)
            if duplicate_aliases:
                raise ValueError(
                    f"duplicate aliases: {', '.join(sorted(duplicate_aliases))}"
                )
            aliases.update(person_aliases)
            for discord_id in person.discordUserIds:
                if not discord_id.isdigit() or not 17 <= len(discord_id) <= 20:
                    raise ValueError(f"invalid Discord user id: {discord_id}")
        return self


class Provenance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["legacy-graph", "maintainer-assertion", "corpus-evidence"]
    reference: str = Field(min_length=1)
    messageIds: list[str]


class RelationshipEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=IDENTIFIER_PATTERN)
    sourceId: str = Field(pattern=IDENTIFIER_PATTERN)
    targetId: str = Field(pattern=IDENTIFIER_PATTERN)
    kind: Literal[
        "membership",
        "friendship",
        "family",
        "romantic",
        "professional",
        "social",
        "adversarial",
        "other",
    ]
    label: str
    direction: Literal["undirected", "source-to-target"]
    status: Literal["current", "historical"]
    effectiveAt: str | None
    recordedAt: str
    supersedesEventId: str | None
    provenance: list[Provenance] = Field(min_length=1)


class RelationshipsDocument(DocumentModel):
    events: list[RelationshipEvent]

    @model_validator(mode="after")
    def validate_event_links(self) -> RelationshipsDocument:
        ids = {event.id for event in self.events}
        if len(ids) != len(self.events):
            raise ValueError("duplicate relationship event id")
        for event in self.events:
            if (
                event.supersedesEventId is not None
                and event.supersedesEventId not in ids
            ):
                raise ValueError(
                    f"unknown superseded event: {event.supersedesEventId}"
                )
        return self


class Coverage(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    messages: int = Field(ge=0)
    date_range: str
    truncated: bool | None = None
    truncated_legacy: bool | None = Field(default=None, alias="truncated?")
    notes: str


class LeagueLanes(BaseModel):
    model_config = ConfigDict(extra="forbid")
    likes: list[str]
    dislikes: list[str]


LeagueValue = str | list[str] | LeagueLanes


class StyleCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    author: str = Field(min_length=1)
    coverage: Coverage
    voice: list[str]
    style_markers: list[str]
    topics: list[str]
    relationships: list[str]
    behaviors: list[str]
    personality: list[str]
    humor_or_tone: list[str]
    quotes: list[str]
    summary: str | list[str]
    likes_dislikes: list[str]
    league: dict[str, LeagueValue]
    other_games: list[str]
    how_to_mimic: list[str]
    sample_messages: list[str]
    concerns: list[str] | None = None


class GenerationStateEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    personId: str = Field(pattern=IDENTIFIER_PATTERN)
    lastMessageId: str | None
    sourceSnapshotChecksum: str | None
    messageCount: int = Field(ge=0)
    refreshedAt: str | None


class GenerationStateDocument(DocumentModel):
    relationshipSourceSnapshotChecksum: str | None
    relationshipRefreshedAt: str | None
    people: list[GenerationStateEntry]


class LoreDocument(DocumentModel):
    historyMarkdown: str = Field(min_length=1)


def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> None:
    people = PeopleDocument.model_validate(load_json(DATA_ROOT / "people.json"))
    relationships = RelationshipsDocument.model_validate(
        load_json(DATA_ROOT / "relationships.json")
    )
    generation_state = GenerationStateDocument.model_validate(
        load_json(DATA_ROOT / "generation-state.json")
    )
    LoreDocument.model_validate(load_json(DATA_ROOT / "lore.json"))

    style_adapter = TypeAdapter(StyleCard)
    style_files = sorted((DATA_ROOT / "style-cards").glob("*_style.json"))
    for path in style_files:
        style_adapter.validate_python(load_json(path))

    people_ids = {person.id for person in people.people}
    for event in relationships.events:
        if event.sourceId not in people_ids or event.targetId not in people_ids:
            raise ValueError(f"relationship references unknown person: {event.id}")
    for state in generation_state.people:
        if state.personId not in people_ids:
            raise ValueError(
                f"generation state references unknown person: {state.personId}"
            )

    print(
        f"OK: {len(people.people)} people, {len(relationships.events)} relationship "
        f"events, and {len(style_files)} style cards"
    )


if __name__ == "__main__":
    main()
