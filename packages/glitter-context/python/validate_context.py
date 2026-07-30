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
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    model_validator,
)

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = PACKAGE_ROOT / "data"
IDENTIFIER_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
DISCORD_ID_PATTERN = r"^\d{17,20}$"
CHECKSUM_PATTERN = r"^[a-f0-9]{64}$"

# Constrained scalar types mirroring the canonical Zod/JSON-Schema contract so
# that the independent Python validator rejects exactly what the shared schema
# rejects (Discord IDs, SHA-256 checksums, and offset-aware ISO timestamps).
Identifier = Annotated[str, Field(pattern=IDENTIFIER_PATTERN)]
DiscordId = Annotated[str, Field(pattern=DISCORD_ID_PATTERN)]
Checksum = Annotated[str, Field(pattern=CHECKSUM_PATTERN)]


class DocumentModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    schema_ref: str | None = Field(default=None, alias="$schema")
    schemaVersion: Literal[1]


class Person(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Identifier
    displayName: str = Field(min_length=1)
    kind: Literal["person", "group"]
    aliases: list[str]
    discordUserIds: list[DiscordId]


class PeopleDocument(DocumentModel):
    people: list[Person]

    @model_validator(mode="after")
    def validate_unique_people(self) -> PeopleDocument:
        ids: set[str] = set()
        aliases: set[str] = set()
        discord_ids: set[str] = set()
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
                if discord_id in discord_ids:
                    raise ValueError(f"duplicate Discord user id: {discord_id}")
                discord_ids.add(discord_id)
        return self


class Provenance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["legacy-graph", "maintainer-assertion", "corpus-evidence"]
    reference: str = Field(min_length=1)
    messageIds: list[DiscordId]


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
    effectiveAt: date | None
    recordedAt: AwareDatetime
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


class LegacyCoverage(BaseModel):
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


class StyleCardContent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    author: str = Field(min_length=1)
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


class LegacyStyleCard(StyleCardContent):
    coverage: LegacyCoverage
    quotes: list[str]
    sample_messages: list[str]
    concerns: list[str] | None = None


class StyleDateRange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: AwareDatetime
    end: AwareDatetime


class CorpusCoverage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    messages: int = Field(ge=0)
    date_range: StyleDateRange


class EvidenceCoverage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    safe_messages: int = Field(ge=0)
    summarized_messages: int = Field(ge=0)
    chunks: int = Field(ge=0)
    direct_recent_messages: int = Field(ge=0)
    date_range: StyleDateRange
    strategy: Literal["all-safe-monthly-chunks-plus-latest-500"]


class StyleCardCoverageV2(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_snapshot_sha256: Checksum
    corpus: CorpusCoverage
    evidence: EvidenceCoverage
    notes: str


SyntheticExamples = Annotated[list[str], Field(min_length=3, max_length=3)]


class SituationalExamples(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provenance: Literal["synthetic"]
    happy_or_excited: SyntheticExamples
    angry_or_frustrated: SyntheticExamples
    sad_or_disappointed: SyntheticExamples
    supportive_or_caring: SyntheticExamples
    playful_or_teasing: SyntheticExamples
    neutral_or_logistical: SyntheticExamples


class StyleCardV2(StyleCardContent):
    schemaVersion: Literal[2]
    coverage: StyleCardCoverageV2
    quotes: Annotated[list[str], Field(min_length=20, max_length=20)]
    sample_messages: Annotated[list[str], Field(min_length=30, max_length=30)]
    situational_examples: SituationalExamples
    concerns: list[str]


StyleCard = LegacyStyleCard | StyleCardV2


class GenerationStateEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    personId: Identifier
    lastMessageId: DiscordId | None
    sourceSnapshotChecksum: Checksum | None
    messageCount: int = Field(ge=0)
    refreshedAt: AwareDatetime | None


class GenerationStateDocument(DocumentModel):
    relationshipSourceSnapshotChecksum: Checksum | None
    relationshipRefreshedAt: AwareDatetime | None
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

    style_adapter: TypeAdapter[StyleCard] = TypeAdapter(StyleCard)
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
