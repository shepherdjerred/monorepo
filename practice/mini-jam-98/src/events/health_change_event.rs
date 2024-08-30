use crate::components::{health::Health, player::Player};

pub struct HealthChangeEvent(Player, Health);
