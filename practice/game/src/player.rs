use crate::bounds::ConstrainToBounds;
use crate::weapons::Weapon;
use crate::TIME_STEP;
use bevy::prelude::*;
use bevy_rapier2d::prelude::*;

#[derive(Component)]
pub struct PlayerCharacter {}

pub fn setup_player(mut commands: Commands, asset_server: Res<AssetServer>) {
    let ship_handle = asset_server.load("textures/ship_C.png");
    commands
        .spawn_bundle(SpriteBundle {
            texture: ship_handle,
            ..default()
        })
        .insert(PlayerCharacter {})
        .insert(ConstrainToBounds {})
        .insert(Weapon {
            projectile_speed: 200.0,
            size: 4.0,
            reload_speed: 10.0,
            remaining_reload_time: 0.0,
        })
        .insert(Collider::cuboid(20.0, 10.0))
        .insert(ActiveEvents::COLLISION_EVENTS)
        .insert(ActiveEvents::CONTACT_FORCE_EVENTS)
        .insert(RigidBody::Dynamic)
        .insert(Velocity {
            linvel: Vec2::new(1.0, 2.0),
            angvel: 0.4,
        });
}

pub fn player_input_system(
    keyboard_input: Res<Input<KeyCode>>,
    mut query: Query<(&PlayerCharacter, &mut Velocity)>,
) {
    let (_, mut velocity) = query.single_mut();

    let mut rotation_factor = 0.0;
    let mut movement_factor = 0.0;

    if keyboard_input.pressed(KeyCode::Left) {
        rotation_factor += 0.5;
    }

    if keyboard_input.pressed(KeyCode::Right) {
        rotation_factor -= 0.5;
    }

    if keyboard_input.pressed(KeyCode::Up) {
        movement_factor += 0.5;
    }

    if keyboard_input.pressed(KeyCode::Down) {
        movement_factor -= 0.3;
    }

    velocity.angvel = (rotation_factor * 10.0 * TIME_STEP) + velocity.angvel;
    velocity.linvel += movement_factor;
}
