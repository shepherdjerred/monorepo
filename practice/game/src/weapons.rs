use bevy::prelude::{Component, Query};

#[derive(Component)]
pub struct Weapon {
    pub projectile_speed: f32,
    pub size: f32,
    pub reload_speed: f32,
    pub remaining_reload_time: f32,
}

pub fn weapon_reload_system(mut query: Query<&mut Weapon>) {
    for mut weapon in &mut query {
        if weapon.remaining_reload_time > 0.0 {
            weapon.remaining_reload_time -= 1.0;
        }
    }
}
