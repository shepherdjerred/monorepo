use crate::components::health::Health;
use crate::components::player::Player;
use crate::components::position::Position;
use bevy::{
    core::FixedTimestep,
    diagnostic::{FrameTimeDiagnosticsPlugin, LogDiagnosticsPlugin},
    prelude::*,
};
use components::moving::{Facing, Moving, State};
use rand::Rng;
use systems::{controls::character_movement, render::render_player};
use ui::setup_ui;
mod components;
mod events;
mod systems;
mod ui;

const TIMESTEP: f64 = 60.0 / 60.0 / 60.0;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugin(LogDiagnosticsPlugin::default())
        .add_plugin(FrameTimeDiagnosticsPlugin::default())
        .add_startup_system(setup)
        .add_startup_system(setup_player)
        .add_startup_system(setup_ui)
        .add_system(player_health_system)
        .add_system_set(
            SystemSet::new()
                .with_run_criteria(FixedTimestep::step(TIMESTEP))
                .with_system(character_movement)
                .with_system(render_player),
        )
        .run();
}

fn player_health_system(mut query: Query<&mut Health, With<Player>>) {
    let mut health = query.single_mut();
    health.current = rand::thread_rng().gen_range(-100..100);
    for health in query.iter() {
        if health.current <= 0 {
            // println!("You are dead!");
        }
    }
}

fn setup(mut commands: Commands, asset_server: Res<AssetServer>) {
    asset_server.watch_for_changes().unwrap();
    commands.spawn_bundle(OrthographicCameraBundle::new_2d());
}

fn setup_player(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut resource: ResMut<Assets<TextureAtlas>>,
) {
    let position = Position { x: 0.0, y: 0.0 };
    let health = Health {
        current: 50,
        max: 100,
    };
    let handle = asset_server.load("timefantasy_characters/sheets/chara2.png");
    let atlas = TextureAtlas::from_grid(handle, Vec2::new(26.0, 36.0), 12, 8);
    let atlas_handle = resource.add(atlas);
    commands
        .spawn()
        .insert_bundle((
            Player {},
            health,
            position,
            Moving {
                facing: Facing::Down,
                state: State::Walk,
                frame: 0,
            },
        ))
        .insert_bundle(SpriteSheetBundle {
            texture_atlas: atlas_handle,
            ..Default::default()
        });
}
