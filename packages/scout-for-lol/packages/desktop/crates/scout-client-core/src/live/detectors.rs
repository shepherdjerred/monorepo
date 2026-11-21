//! Proactive coach detectors: deterministic rules over two consecutive
//! [`LiveSnapshot`]s that say when Scout may ask for a coach turn the player
//! did not.
//!
//! Riot's published policy prohibits unprompted alerts from live game state,
//! so this module is compiled only into the beta release profile
//! (`cfg(scout_proactive_coach)`, set by `build.rs`), and the server refuses
//! `coach/triggers` in production whatever its flags say. Nothing sends what
//! these detectors find yet; a later change wires them to the supervisor
//! behind `scout_coach_proactive`.
//!
//! Every rule reads only scoreboard fields of the allowlisted snapshot: team,
//! champion, kills, deaths, assists and items. None reads a cooldown, a timer,
//! a position or the enemy ward score (the snapshot has none), and none
//! infers anything from fog or from a gap between frames. Item facts come
//! from Riot's Data Dragon `item.json` through [`ItemCatalog`].
//!
//! [`detect`] is pure: the same catalog, state and frames always give the same
//! triggers, in the contract's kind order.

use std::collections::HashMap;

use serde::Deserialize;
use thiserror::Error;

use super::snapshot::{LiveParticipant, LiveSnapshot, Team};
use crate::desktop_api::{CoachTrigger, DamageProfile};

/// Gold at or above which a final item counts as completed (legendary).
pub const LEGENDARY_MIN_GOLD: u32 = 2_000;

/// Completed items a player only ever holds by transforming another one:
/// Seraph's Embrace (from Archangel's Staff), Muramana (from Manamune) and
/// Fimbulwinter (from Winter's Approach). Data Dragon lists them as not
/// purchasable, so without this a transform would erase a completed item.
const TRANSFORMED_FINAL_ITEMS: [u32; 3] = [3040, 3042, 3121];
/// Item spikes worth a note: an enemy's first, second and third completed item.
pub const ITEM_SPIKE_MAX_COMPLETED: u8 = 3;
/// Fed: at least this many kills ...
pub const FED_MIN_KILLS: u32 = 5;
/// ... and at least this many more kills than deaths.
pub const FED_MIN_LEAD: u32 = 4;
/// A damage profile needs this many completed damage items across the team.
pub const PROFILE_MIN_ITEMS: u32 = 3;
/// A damage type dominates at this share of the team's damage items.
pub const PROFILE_DOMINANT_PERCENT: u32 = 65;
/// Completed healing items across the enemy team that make a healing threat.
pub const HEALING_MIN_ITEMS: u8 = 2;
/// Deaths without a kill or assist that make a death streak.
pub const DEATH_STREAK_MIN: u8 = 3;

/// The damage an item adds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DamageClass {
    /// Attack damage, critical strike or armor penetration.
    Physical,
    /// Ability power.
    Magic,
    /// Both.
    Mixed,
}

/// What a detector needs to know about one item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ItemFacts {
    /// A purchasable (or transformed, see [`TRANSFORMED_FINAL_ITEMS`]) final item of at least [`LEGENDARY_MIN_GOLD`].
    pub completed: bool,
    /// The damage it adds, if any.
    pub damage: Option<DamageClass>,
    /// It grants life steal or omnivamp.
    pub heals: bool,
    /// It applies Grievous Wounds.
    pub anti_heal: bool,
}

/// Why Data Dragon's `item.json` could not be read.
#[derive(Debug, Error)]
pub enum CatalogError {
    /// The document is not the shape Data Dragon publishes.
    #[error("item.json does not parse: {0}")]
    Json(#[from] serde_json::Error),
    /// An item key is not a numeric item id.
    #[error("item.json names a non-numeric item id {0:?}")]
    ItemId(String),
}

/// `item.json`, read leniently: Riot owns it, so only the fields used here.
#[derive(Deserialize)]
struct DataDragonItems {
    data: HashMap<String, DataDragonItem>,
}

#[derive(Deserialize)]
struct DataDragonItem {
    #[serde(default)]
    description: String,
    gold: DataDragonGold,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    into: Vec<String>,
}

#[derive(Deserialize)]
struct DataDragonGold {
    total: u32,
    purchasable: bool,
}

impl DataDragonItem {
    fn facts(&self, id: u32) -> ItemFacts {
        let tagged = |names: &[&str]| self.tags.iter().any(|tag| names.contains(&tag.as_str()));
        let physical = tagged(&["Damage", "CriticalStrike", "ArmorPenetration"]);
        let magic = tagged(&["SpellDamage"]);
        ItemFacts {
            completed: (self.gold.purchasable || TRANSFORMED_FINAL_ITEMS.contains(&id))
                && self.into.is_empty()
                && self.gold.total >= LEGENDARY_MIN_GOLD,
            damage: match (physical, magic) {
                (true, true) => Some(DamageClass::Mixed),
                (true, false) => Some(DamageClass::Physical),
                (false, true) => Some(DamageClass::Magic),
                (false, false) => None,
            },
            heals: tagged(&["LifeSteal", "SpellVamp"]),
            anti_heal: self.description.contains("Wounds"),
        }
    }
}

/// Item facts by item id. An item the catalog does not know adds nothing:
/// it is not completed, deals no damage and neither heals nor cuts healing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ItemCatalog {
    items: HashMap<u32, ItemFacts>,
}

impl ItemCatalog {
    /// A catalog of these facts.
    pub fn from_facts(items: impl IntoIterator<Item = (u32, ItemFacts)>) -> Self {
        Self {
            items: items.into_iter().collect(),
        }
    }

    /// The catalog of a Data Dragon `item.json`.
    ///
    /// # Errors
    ///
    /// [`CatalogError`] when the document is not Data Dragon's shape or names
    /// an item id that is not a number.
    pub fn from_data_dragon(json: &str) -> Result<Self, CatalogError> {
        let document: DataDragonItems = serde_json::from_str(json)?;
        let mut items = HashMap::with_capacity(document.data.len());
        for (key, item) in &document.data {
            let id = key
                .parse::<u32>()
                .map_err(|_| CatalogError::ItemId(key.clone()))?;
            items.insert(id, item.facts(id));
        }
        Ok(Self { items })
    }

    /// What this catalog knows of an item.
    #[must_use]
    pub fn facts(&self, item_id: u32) -> ItemFacts {
        self.items.get(&item_id).copied().unwrap_or_default()
    }

    fn completed<'a>(&'a self, player: &'a LiveParticipant) -> impl Iterator<Item = u32> + 'a {
        player
            .items
            .iter()
            .map(|item| item.item_id)
            .filter(|id| self.facts(*id).completed)
    }
}

/// What the detectors carry from one frame to the next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DetectorState {
    deaths_without_takedown: u8,
}

impl DetectorState {
    /// The player's deaths since their last kill or assist.
    #[must_use]
    pub const fn deaths_without_takedown(&self) -> u8 {
        self.deaths_without_takedown
    }
}

/// The triggers one frame produced, and the state for the next frame.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Detection {
    /// The state to pass with the next frame.
    pub state: DetectorState,
    /// What fired, in the contract's kind order.
    pub triggers: Vec<CoachTrigger>,
}

/// Count as a `u8`, saturating; a scoreboard never comes close.
fn count(value: usize) -> u8 {
    u8::try_from(value).unwrap_or(u8::MAX)
}

/// Whether two frames are consecutive frames of one game: same mode and map,
/// the same roster in the same order, and a clock that did not run backwards.
fn continuous(previous: &LiveSnapshot, current: &LiveSnapshot) -> bool {
    previous.game.mode == current.game.mode
        && previous.game.map == current.game.map
        && current.game.game_time_secs >= previous.game.game_time_secs
        && previous.participants.len() == current.participants.len()
        && previous
            .participants
            .iter()
            .zip(&current.participants)
            .all(|(before, now)| {
                before.team == now.team
                    && before.is_self == now.is_self
                    && before.champion == now.champion
            })
}

/// Run every detector over one pair of consecutive frames.
///
/// Frames that are not consecutive frames of one game (a new game, a
/// reordered roster, a clock that ran backwards) produce nothing and reset
/// the state.
#[must_use]
pub fn detect(
    catalog: &ItemCatalog,
    state: DetectorState,
    previous: &LiveSnapshot,
    current: &LiveSnapshot,
) -> Detection {
    let (Some(local_before), Some(local_now)) = (previous.local(), current.local()) else {
        return Detection::default();
    };
    if !continuous(previous, current) {
        return Detection::default();
    }
    let local_team = local_now.team;
    let enemies: Vec<(&LiveParticipant, &LiveParticipant)> = previous
        .participants
        .iter()
        .zip(&current.participants)
        .filter(|(_, now)| now.team != local_team)
        .collect();

    let mut triggers = Vec::new();
    triggers.extend(item_spikes(catalog, &enemies));
    triggers.extend(fed_enemies(&enemies));
    triggers.extend(damage_profile_shift(catalog, previous, current, local_team));
    triggers.extend(healing_threat(
        catalog, previous, current, local_team, local_now,
    ));
    let (state, streak) = death_streak(state, local_before, local_now);
    triggers.extend(streak);
    Detection { state, triggers }
}

/// An enemy's newly completed items, while they hold at most
/// [`ITEM_SPIKE_MAX_COMPLETED`].
fn item_spikes(
    catalog: &ItemCatalog,
    enemies: &[(&LiveParticipant, &LiveParticipant)],
) -> Vec<CoachTrigger> {
    let mut found = Vec::new();
    for (before, now) in enemies {
        let held_before: Vec<u32> = catalog.completed(before).collect();
        let held_now: Vec<u32> = catalog.completed(now).collect();
        let completed_items = count(held_now.len());
        if completed_items > ITEM_SPIKE_MAX_COMPLETED {
            continue;
        }
        let mut seen: Vec<u32> = Vec::new();
        for item in &now.items {
            if !catalog.facts(item.item_id).completed || seen.contains(&item.item_id) {
                continue;
            }
            seen.push(item.item_id);
            let had = held_before.iter().filter(|id| **id == item.item_id).count();
            let has = held_now.iter().filter(|id| **id == item.item_id).count();
            if has > had {
                found.push(CoachTrigger::EnemyItemSpike {
                    champion: now.champion.clone(),
                    item_id: item.item_id,
                    item_name: item.name.clone(),
                    completed_items,
                });
            }
        }
    }
    found
}

fn is_fed(player: &LiveParticipant) -> bool {
    player.kills >= FED_MIN_KILLS && player.kills >= player.deaths.saturating_add(FED_MIN_LEAD)
}

/// Enemies who crossed into fed on this frame.
fn fed_enemies(enemies: &[(&LiveParticipant, &LiveParticipant)]) -> Vec<CoachTrigger> {
    enemies
        .iter()
        .filter(|(before, now)| !is_fed(before) && is_fed(now))
        .map(|(_, now)| CoachTrigger::EnemyFed {
            champion: now.champion.clone(),
            kills: now.kills,
            deaths: now.deaths,
            assists: now.assists,
        })
        .collect()
}

/// Completed physical and magic damage items across the local team's
/// enemies; a mixed item counts as both.
fn team_damage(catalog: &ItemCatalog, snapshot: &LiveSnapshot, local_team: Team) -> (u8, u8) {
    let mut physical = 0_usize;
    let mut magic = 0_usize;
    for player in snapshot
        .participants
        .iter()
        .filter(|p| p.team != local_team)
    {
        for id in catalog.completed(player) {
            match catalog.facts(id).damage {
                Some(DamageClass::Physical) => physical += 1,
                Some(DamageClass::Magic) => magic += 1,
                Some(DamageClass::Mixed) => {
                    physical += 1;
                    magic += 1;
                }
                None => {}
            }
        }
    }
    (count(physical), count(magic))
}

/// The dominant damage type, once the team has enough damage items to have one.
fn profile(physical: u8, magic: u8) -> Option<DamageProfile> {
    let total = u32::from(physical) + u32::from(magic);
    if total < PROFILE_MIN_ITEMS {
        return None;
    }
    if u32::from(magic) * 100 >= PROFILE_DOMINANT_PERCENT * total {
        Some(DamageProfile::Magic)
    } else if u32::from(physical) * 100 >= PROFILE_DOMINANT_PERCENT * total {
        Some(DamageProfile::Physical)
    } else {
        Some(DamageProfile::Mixed)
    }
}

/// The enemy team's damage profile changed between two established profiles.
fn damage_profile_shift(
    catalog: &ItemCatalog,
    previous: &LiveSnapshot,
    current: &LiveSnapshot,
    local_team: Team,
) -> Option<CoachTrigger> {
    let (physical_before, magic_before) = team_damage(catalog, previous, local_team);
    let (physical_items, magic_items) = team_damage(catalog, current, local_team);
    let from = profile(physical_before, magic_before)?;
    let to = profile(physical_items, magic_items)?;
    (from != to).then_some(CoachTrigger::DamageProfileShift {
        from,
        to,
        physical_items,
        magic_items,
    })
}

fn healing_items(catalog: &ItemCatalog, snapshot: &LiveSnapshot, local_team: Team) -> u8 {
    count(
        snapshot
            .participants
            .iter()
            .filter(|player| player.team != local_team)
            .flat_map(|player| catalog.completed(player))
            .filter(|id| catalog.facts(*id).heals)
            .count(),
    )
}

/// The enemy team crossed [`HEALING_MIN_ITEMS`] completed healing items while
/// the player holds no anti-heal item, a component included.
fn healing_threat(
    catalog: &ItemCatalog,
    previous: &LiveSnapshot,
    current: &LiveSnapshot,
    local_team: Team,
    local: &LiveParticipant,
) -> Option<CoachTrigger> {
    let before = healing_items(catalog, previous, local_team);
    let now = healing_items(catalog, current, local_team);
    let own_anti_heal = local
        .items
        .iter()
        .any(|item| catalog.facts(item.item_id).anti_heal);
    (before < HEALING_MIN_ITEMS && now >= HEALING_MIN_ITEMS && !own_anti_heal)
        .then_some(CoachTrigger::HealingThreat { healing_items: now })
}

/// Count the player's deaths since their last takedown, and fire once when
/// the count reaches [`DEATH_STREAK_MIN`]. A takedown on the same frame as a
/// death resets the count first.
fn death_streak(
    state: DetectorState,
    before: &LiveParticipant,
    now: &LiveParticipant,
) -> (DetectorState, Option<CoachTrigger>) {
    let takedown =
        now.kills.saturating_add(now.assists) > before.kills.saturating_add(before.assists);
    let base = if takedown {
        0
    } else {
        state.deaths_without_takedown
    };
    let died = u8::try_from(now.deaths.saturating_sub(before.deaths)).unwrap_or(u8::MAX);
    let next = base.saturating_add(died);
    let trigger = (base < DEATH_STREAK_MIN && next >= DEATH_STREAK_MIN).then_some(
        CoachTrigger::DeathStreak {
            deaths: now.deaths,
            deaths_without_takedown: next,
        },
    );
    (
        DetectorState {
            deaths_without_takedown: next,
        },
        trigger,
    )
}

#[cfg(test)]
mod tests {
    use super::{DEATH_STREAK_MIN, DamageClass, DetectorState, ItemCatalog, ItemFacts, detect};
    use crate::desktop_api::{CoachTrigger, DamageProfile};
    use crate::live::snapshot::{
        LiveGameInfo, LiveItem, LiveParticipant, LiveSnapshot, OwnStats, Team,
    };

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const PHYSICAL: u32 = 3001;
    const MAGIC: u32 = 3002;
    const PHYSICAL_HEAL: u32 = 3003;
    const MAGIC_HEAL: u32 = 3004;
    const ANTI_HEAL_PART: u32 = 3005;
    const MIXED: u32 = 3006;
    const BOOTS: u32 = 1001;
    const UNKNOWN: u32 = 9999;

    fn completed(damage: Option<DamageClass>, heals: bool) -> ItemFacts {
        ItemFacts {
            completed: true,
            damage,
            heals,
            anti_heal: false,
        }
    }

    fn catalog() -> ItemCatalog {
        ItemCatalog::from_facts([
            (PHYSICAL, completed(Some(DamageClass::Physical), false)),
            (MAGIC, completed(Some(DamageClass::Magic), false)),
            (PHYSICAL_HEAL, completed(Some(DamageClass::Physical), true)),
            (MAGIC_HEAL, completed(Some(DamageClass::Magic), true)),
            (MIXED, completed(Some(DamageClass::Mixed), false)),
            (
                ANTI_HEAL_PART,
                ItemFacts {
                    anti_heal: true,
                    ..ItemFacts::default()
                },
            ),
            (BOOTS, ItemFacts::default()),
        ])
    }

    /// A scoreboard row: team, champion, K/D/A and item ids.
    #[derive(Clone, Copy)]
    struct Row(Team, bool, &'static str, u32, u32, u32, &'static [u32]);

    fn participant(row: Row) -> LiveParticipant {
        let Row(team, is_self, champion, kills, deaths, assists, items) = row;
        LiveParticipant {
            team,
            is_self,
            champion: champion.to_owned(),
            level: 11,
            kills,
            deaths,
            assists,
            creep_score: 120,
            items: items
                .iter()
                .map(|id| LiveItem {
                    item_id: *id,
                    name: format!("Item {id}"),
                    count: 1,
                })
                .collect(),
            summoner_spells: ["Flash".to_owned(), "Ignite".to_owned()],
            keystone: None,
        }
    }

    fn frame(time: u32, rows: &[Row]) -> LiveSnapshot {
        LiveSnapshot {
            game: LiveGameInfo {
                mode: "CLASSIC".to_owned(),
                map: "Map11".to_owned(),
                game_time_secs: time,
            },
            own: OwnStats {
                gold: 500,
                max_health: 1500.0,
                health: 1200.0,
                resource: "MANA".to_owned(),
                max_resource: 900.0,
                current_resource: 400.0,
                armor: 60.0,
                magic_resist: 45.0,
                attack_damage: 80.0,
                ability_power: 200.0,
                attack_speed: 0.7,
                move_speed: 360.0,
                crit_chance: 0.0,
            },
            participants: rows.iter().copied().map(participant).collect(),
            event_count: 10,
            latest_event: None,
        }
    }

    const ME: Row = Row(Team::Order, true, "Ahri", 2, 1, 3, &[]);
    const ALLY: Row = Row(Team::Order, false, "Garen", 1, 1, 1, &[]);
    const ZED: Row = Row(Team::Chaos, false, "Zed", 1, 1, 1, &[]);
    const VLAD: Row = Row(Team::Chaos, false, "Vladimir", 1, 1, 1, &[]);

    fn with_items(row: Row, items: &'static [u32]) -> Row {
        Row(row.0, row.1, row.2, row.3, row.4, row.5, items)
    }

    fn with_score(row: Row, kills: u32, deaths: u32, assists: u32) -> Row {
        Row(row.0, row.1, row.2, kills, deaths, assists, row.6)
    }

    fn triggers(before: &[Row], now: &[Row]) -> Vec<CoachTrigger> {
        detect(
            &catalog(),
            DetectorState::default(),
            &frame(600, before),
            &frame(602, now),
        )
        .triggers
    }

    fn spike(champion: &str, item_id: u32, completed_items: u8) -> CoachTrigger {
        CoachTrigger::EnemyItemSpike {
            champion: champion.to_owned(),
            item_id,
            item_name: format!("Item {item_id}"),
            completed_items,
        }
    }

    /// A named case: the frame before, the frame now, and what fires.
    type FrameCase<'a> = (&'static str, &'a [Row], &'a [Row], Vec<CoachTrigger>);
    /// A named case: Zed's and Vladimir's items before and now, and what fires.
    type ItemsCase = (
        &'static str,
        [&'static [u32]; 2],
        [&'static [u32]; 2],
        Vec<CoachTrigger>,
    );

    #[test]
    fn item_spikes() {
        let cases: [FrameCase<'_>; 7] = [
            (
                "an enemy's first completed item",
                &[ME, ZED],
                &[ME, with_items(ZED, &[PHYSICAL])],
                vec![spike("Zed", PHYSICAL, 1)],
            ),
            (
                "an enemy's third completed item",
                &[ME, with_items(ZED, &[PHYSICAL, MAGIC])],
                &[ME, with_items(ZED, &[PHYSICAL, MAGIC, MIXED])],
                vec![spike("Zed", MIXED, 3)],
            ),
            (
                "a fourth completed item is past the spikes",
                &[ME, with_items(ZED, &[PHYSICAL, MAGIC, MIXED])],
                &[ME, with_items(ZED, &[PHYSICAL, MAGIC, MIXED, MAGIC_HEAL])],
                vec![],
            ),
            (
                "boots are not a completed item",
                &[ME, ZED],
                &[ME, with_items(ZED, &[BOOTS])],
                vec![],
            ),
            (
                "an item the catalog does not know adds nothing",
                &[ME, ZED],
                &[ME, with_items(ZED, &[UNKNOWN])],
                vec![],
            ),
            (
                "an ally's item is not an enemy spike",
                &[ME, ALLY, ZED],
                &[ME, with_items(ALLY, &[PHYSICAL]), ZED],
                vec![],
            ),
            (
                "an item already held does not fire again",
                &[ME, with_items(ZED, &[PHYSICAL])],
                &[ME, with_items(ZED, &[PHYSICAL, BOOTS])],
                vec![],
            ),
        ];
        for (name, before, now, expected) in cases {
            assert_eq!(triggers(before, now), expected, "{name}");
        }
    }

    #[test]
    fn fed_enemies() {
        let fed = |kills, deaths, assists| CoachTrigger::EnemyFed {
            champion: "Zed".to_owned(),
            kills,
            deaths,
            assists,
        };
        let cases: [(&str, Row, Row, Vec<CoachTrigger>); 5] = [
            (
                "five kills and no deaths",
                with_score(ZED, 4, 0, 1),
                with_score(ZED, 5, 0, 1),
                vec![fed(5, 0, 1)],
            ),
            (
                "a lead of three is not fed",
                with_score(ZED, 5, 3, 0),
                with_score(ZED, 6, 3, 0),
                vec![],
            ),
            (
                "six kills over two deaths",
                with_score(ZED, 5, 2, 0),
                with_score(ZED, 6, 2, 0),
                vec![fed(6, 2, 0)],
            ),
            (
                "already fed does not fire again",
                with_score(ZED, 5, 0, 0),
                with_score(ZED, 6, 0, 0),
                vec![],
            ),
            (
                "four kills is not enough",
                with_score(ZED, 3, 0, 0),
                with_score(ZED, 4, 0, 0),
                vec![],
            ),
        ];
        for (name, before, now, expected) in cases {
            assert_eq!(triggers(&[ME, before], &[ME, now]), expected, "{name}");
        }
        // An ally on the same score is not an enemy.
        assert_eq!(
            triggers(
                &[ME, with_score(ALLY, 4, 0, 0), ZED],
                &[ME, with_score(ALLY, 5, 0, 0), ZED]
            ),
            vec![]
        );
    }

    #[test]
    fn damage_profile_shifts() {
        let shift = |from, to, physical_items, magic_items| CoachTrigger::DamageProfileShift {
            from,
            to,
            physical_items,
            magic_items,
        };
        let cases: [ItemsCase; 4] = [
            (
                "physical turns mixed",
                [&[PHYSICAL, PHYSICAL], &[PHYSICAL]],
                [&[PHYSICAL, PHYSICAL], &[PHYSICAL, MAGIC, MAGIC_HEAL]],
                vec![
                    spike("Vladimir", MAGIC, 3),
                    spike("Vladimir", MAGIC_HEAL, 3),
                    shift(DamageProfile::Physical, DamageProfile::Mixed, 3, 2),
                ],
            ),
            (
                "too few damage items have no profile yet",
                [&[PHYSICAL], &[]],
                [&[PHYSICAL], &[MAGIC]],
                vec![spike("Vladimir", MAGIC, 1)],
            ),
            (
                "a mixed item counts toward both",
                [&[PHYSICAL, MAGIC], &[MAGIC]],
                [&[PHYSICAL, MAGIC], &[MAGIC, MIXED]],
                vec![
                    spike("Vladimir", MIXED, 2),
                    shift(DamageProfile::Magic, DamageProfile::Mixed, 2, 3),
                ],
            ),
            (
                "the same profile does not fire",
                [&[MAGIC, MAGIC], &[MAGIC]],
                [&[MAGIC, MAGIC], &[MAGIC, MAGIC]],
                vec![spike("Vladimir", MAGIC, 2)],
            ),
        ];
        for (name, [zed_before, vlad_before], [zed_now, vlad_now], expected) in cases {
            let before = [
                ME,
                with_items(ZED, zed_before),
                with_items(VLAD, vlad_before),
            ];
            let now = [ME, with_items(ZED, zed_now), with_items(VLAD, vlad_now)];
            assert_eq!(triggers(&before, &now), expected, "{name}");
        }
    }

    #[test]
    fn healing_threats() {
        let threat = CoachTrigger::HealingThreat { healing_items: 2 };
        let before = [ME, with_items(ZED, &[PHYSICAL_HEAL]), VLAD];
        let now = [
            ME,
            with_items(ZED, &[PHYSICAL_HEAL]),
            with_items(VLAD, &[MAGIC_HEAL]),
        ];
        let fired = triggers(&before, &now);
        assert_eq!(fired.last(), Some(&threat));

        // The player already holds an anti-heal component.
        let armed = with_items(ME, &[ANTI_HEAL_PART]);
        let mut before_armed = before;
        before_armed[0] = armed;
        let mut now_armed = now;
        now_armed[0] = armed;
        assert!(!triggers(&before_armed, &now_armed).contains(&threat));

        // Past the threshold already: no second alert.
        let three = [
            ME,
            with_items(ZED, &[PHYSICAL_HEAL, MAGIC_HEAL]),
            with_items(VLAD, &[MAGIC_HEAL]),
        ];
        assert!(
            !triggers(&now, &three)
                .iter()
                .any(|t| matches!(t, CoachTrigger::HealingThreat { .. }))
        );
    }

    #[test]
    fn death_streaks_fire_once_and_reset_on_a_takedown() -> TestResult {
        let catalog = catalog();
        // (kills, deaths, assists) of the player, frame by frame.
        let scores = [
            (2, 1, 3),
            (2, 2, 3),
            (2, 3, 3),
            (2, 4, 3), // third death without a takedown
            (2, 5, 3), // still streaking: no second alert
            (2, 5, 4), // an assist resets
            (2, 6, 4),
            (2, 7, 4),
            (2, 8, 4), // a new streak of three
        ];
        let mut state = DetectorState::default();
        let mut fired = Vec::new();
        for pair in scores.windows(2) {
            let [(k0, d0, a0), (k1, d1, a1)] = pair else {
                return Err("windows(2) yields pairs".into());
            };
            let before = frame(600, &[with_score(ME, *k0, *d0, *a0), ZED]);
            let now = frame(602, &[with_score(ME, *k1, *d1, *a1), ZED]);
            let detection = detect(&catalog, state, &before, &now);
            state = detection.state;
            fired.extend(detection.triggers);
        }
        assert_eq!(
            fired,
            vec![
                CoachTrigger::DeathStreak {
                    deaths: 4,
                    deaths_without_takedown: DEATH_STREAK_MIN,
                },
                CoachTrigger::DeathStreak {
                    deaths: 8,
                    deaths_without_takedown: DEATH_STREAK_MIN,
                },
            ]
        );
        assert_eq!(state.deaths_without_takedown(), 3);
        Ok(())
    }

    #[test]
    fn frames_of_different_games_detect_nothing_and_reset() {
        let catalog = catalog();
        let state = detect(
            &catalog,
            DetectorState::default(),
            &frame(600, &[with_score(ME, 0, 0, 0), ZED]),
            &frame(602, &[with_score(ME, 0, 2, 0), ZED]),
        )
        .state;
        assert_eq!(state.deaths_without_takedown(), 2);
        let before = frame(600, &[ME, ZED]);
        let cases = [
            (
                "the clock ran backwards",
                frame(10, &[ME, with_items(ZED, &[PHYSICAL])]),
            ),
            (
                "another roster",
                frame(602, &[ME, with_items(VLAD, &[PHYSICAL])]),
            ),
            ("no local player", {
                let mut other = frame(602, &[ME, with_items(ZED, &[PHYSICAL])]);
                for player in &mut other.participants {
                    player.is_self = false;
                }
                other
            }),
        ];
        for (name, now) in cases {
            let detection = detect(&catalog, state, &before, &now);
            assert_eq!(detection.triggers, vec![], "{name}");
            assert_eq!(detection.state, DetectorState::default(), "{name}");
        }
    }

    #[test]
    fn detection_is_deterministic_and_in_kind_order() {
        let before = [
            with_score(ME, 0, 2, 0),
            with_items(with_score(ZED, 4, 0, 0), &[PHYSICAL_HEAL]),
            with_items(VLAD, &[PHYSICAL, PHYSICAL]),
        ];
        let now = [
            with_score(ME, 0, 3, 0),
            with_items(with_score(ZED, 5, 0, 0), &[PHYSICAL_HEAL, MAGIC]),
            with_items(VLAD, &[PHYSICAL, PHYSICAL, MAGIC_HEAL]),
        ];
        let state = detect(
            &catalog(),
            DetectorState::default(),
            &frame(500, &[with_score(ME, 0, 0, 0), ZED, VLAD]),
            &frame(502, &[with_score(ME, 0, 2, 0), ZED, VLAD]),
        )
        .state;
        let first = detect(&catalog(), state, &frame(600, &before), &frame(602, &now));
        let again = detect(&catalog(), state, &frame(600, &before), &frame(602, &now));
        assert_eq!(first, again);
        let kinds: Vec<&str> = first.triggers.iter().map(CoachTrigger::kind).collect();
        assert_eq!(
            kinds,
            [
                "enemy_item_spike",
                "enemy_item_spike",
                "enemy_fed",
                "damage_profile_shift",
                "healing_threat",
                "death_streak",
            ]
        );
    }

    #[test]
    fn data_dragon_items_classify_as_league_plays_them() -> TestResult {
        let catalog = ItemCatalog::from_data_dragon(include_str!(
            "../../../../../data/src/data-dragon/assets/item.json"
        ))?;
        let bloodthirster = catalog.facts(3072);
        assert!(bloodthirster.completed && bloodthirster.heals);
        assert_eq!(bloodthirster.damage, Some(DamageClass::Physical));
        let deathcap = catalog.facts(3089);
        assert!(deathcap.completed && !deathcap.heals);
        assert_eq!(deathcap.damage, Some(DamageClass::Magic));
        let riftmaker = catalog.facts(4633);
        assert!(riftmaker.completed && riftmaker.heals);
        assert!(catalog.facts(3075).anti_heal, "Thornmail");
        let bramble = catalog.facts(3076);
        assert!(bramble.anti_heal && !bramble.completed, "Bramble Vest");
        assert!(!catalog.facts(1001).completed, "Boots");
        for (id, name) in [
            (3040, "Seraph's Embrace"),
            (3042, "Muramana"),
            (3121, "Fimbulwinter"),
        ] {
            assert!(catalog.facts(id).completed, "{name} stays completed");
        }
        assert_eq!(catalog.facts(424_242), ItemFacts::default());
        Ok(())
    }

    #[test]
    fn a_non_numeric_item_id_is_a_broken_document() {
        let json = r#"{"data":{"boots":{"gold":{"total":300,"purchasable":true}}}}"#;
        assert!(ItemCatalog::from_data_dragon(json).is_err());
    }
}
