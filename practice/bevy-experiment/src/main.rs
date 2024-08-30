use bevy::diagnostic::{FrameTimeDiagnosticsPlugin, PrintDiagnosticsPlugin};
use bevy::{prelude::*, render::camera::Camera};
use bevy_tiled_prototype::TiledMapCenter;

fn main() {
    App::build()
        .add_plugins(DefaultPlugins)
        .add_plugin(bevy_tiled_prototype::TiledMapPlugin)
        .add_startup_system(setup.system())
        .add_system(camera_movement.system())
        .add_system(character_movement.system())
        .add_plugin(PrintDiagnosticsPlugin::default())
        .add_plugin(FrameTimeDiagnosticsPlugin::default())
        .add_system(PrintDiagnosticsPlugin::print_diagnostics_system.system())
        .add_startup_system(create_character.system())
        .run();
}

fn create_character(
    commands: &mut Commands,
    asset_server: Res<AssetServer>,
    mut materials: ResMut<Assets<ColorMaterial>>,
) {
    let texture_handle = asset_server.load("front_air.png");
    commands.spawn(SpriteBundle {
        material: materials.add(texture_handle.into()),
        transform: Transform {
            translation: Vec3::new(0.0, 0.0, 3.0),
            scale: Vec3::new(4.0, 4.0, 0.0),
            ..Default::default()
        },
        ..Default::default()
    });
}

fn character_movement(
    time: Res<Time>,
    keyboard_input: Res<Input<KeyCode>>,
    mut query: Query<(&Sprite, &mut Transform)>,
) {
    for (_, mut transform) in query.iter_mut() {
        let mut direction = Vec3::zero();

        if keyboard_input.pressed(KeyCode::Right) {
            direction += Vec3::new(2.0, 0.0, 0.0);
        }

        if keyboard_input.pressed(KeyCode::Left) {
            direction += Vec3::new(-2.0, 0.0, 0.0);
        }

        if keyboard_input.pressed(KeyCode::Down) {
            direction += Vec3::new(0.0, -2.0, 0.0);
        }

        if keyboard_input.pressed(KeyCode::Up) {
            direction += Vec3::new(0.0, 2.0, 0.0);
        }

        transform.translation += time.delta_seconds() * direction * 1000.;
    }
}

fn setup(commands: &mut Commands, asset_server: Res<AssetServer>) {
    commands
        .spawn(bevy_tiled_prototype::TiledMapComponents {
            map_asset: asset_server.load("timefantasy/winter/tiles/map.tmx"),
            center: TiledMapCenter(true),
            origin: Transform::from_scale(Vec3::new(4.0, 4.0, 1.0)),
            ..Default::default()
        })
        .spawn(Camera2dBundle::default());
}

fn camera_movement(
    time: Res<Time>,
    keyboard_input: Res<Input<KeyCode>>,
    mut query: Query<(&Camera, &mut Transform)>,
) {
    for (_, mut transform) in query.iter_mut() {
        let mut direction = Vec3::zero();
        let scale = transform.scale.x;

        if keyboard_input.pressed(KeyCode::A) {
            direction -= Vec3::new(1.0, 0.0, 0.0);
        }

        if keyboard_input.pressed(KeyCode::D) {
            direction += Vec3::new(1.0, 0.0, 0.0);
        }

        if keyboard_input.pressed(KeyCode::W) {
            direction += Vec3::new(0.0, 1.0, 0.0);
        }

        if keyboard_input.pressed(KeyCode::S) {
            direction -= Vec3::new(0.0, 1.0, 0.0);
        }

        if keyboard_input.pressed(KeyCode::Z) {
            let scale = scale + 0.1;
            transform.scale = Vec3::new(scale, scale, scale);
        }

        if keyboard_input.pressed(KeyCode::X) && scale > 1.1 {
            let scale = scale - 0.1;
            transform.scale = Vec3::new(scale, scale, scale);
        }

        transform.translation += time.delta_seconds() * direction * 1000.;
    }
}
