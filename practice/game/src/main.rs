mod bounds;
mod enemy;
mod missile;
mod player;
mod weapons;

use bevy_rapier2d::prelude::*;

use crate::bounds::{
    constrained_to_bounds_system, despawn_out_of_bounds_system, track_out_of_bounds_system,
};
use crate::enemy::setup_enemy;
use crate::missile::{display_events, player_shoot_missile_system};
use crate::player::{player_input_system, setup_player};
use crate::weapons::weapon_reload_system;
use bevy::window::PresentMode;
use bevy::{prelude::*, time::FixedTimestep};

pub const TIME_STEP: f32 = 1.0 / 60.0;
pub const BOUNDS: Vec2 = Vec2::new(1200.0, 640.0);

fn main() {
    App::new()
        .insert_resource(WindowDescriptor {
            title: "Really fun game!".to_string(),
            width: 1200.,
            height: 640.,
            present_mode: PresentMode::AutoVsync,
            ..default()
        })
        .add_plugins(DefaultPlugins)
        .add_plugin(RapierPhysicsPlugin::<NoUserData>::pixels_per_meter(100.0))
        .add_plugin(RapierDebugRenderPlugin::default())
        .insert_resource(RapierConfiguration {
            gravity: Vect::splat(0.0),
            ..Default::default()
        })
        .add_startup_system(setup_player)
        .add_startup_system(setup_camera)
        .add_startup_system(setup_enemy)
        .add_system_set(
            SystemSet::new()
                .with_run_criteria(FixedTimestep::step(TIME_STEP as f64))
                .with_system(player_input_system)
                .with_system(player_shoot_missile_system)
                .with_system(constrained_to_bounds_system)
                .with_system(despawn_out_of_bounds_system.exclusive_system())
                .with_system(track_out_of_bounds_system)
                .with_system(weapon_reload_system)
                .with_system(display_events),
        )
        .add_system(bevy::window::close_on_esc)
        .run();
}

fn setup_camera(mut commands: Commands) {
    commands.spawn_bundle(Camera2dBundle::default());
}
