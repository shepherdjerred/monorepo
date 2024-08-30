use bevy::prelude::Component;
#[derive(Component, Copy, Clone)]
pub struct Health {
    pub current: i8,
    pub max: i8,
}
