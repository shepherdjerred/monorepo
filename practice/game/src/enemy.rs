use crate::bounds::ConstrainToBounds;
use bevy::asset::AssetServer;
use bevy::math::Vec3;
use bevy::prelude::*;
use bevy_rapier2d::prelude::*;

#[derive(Component)]
pub struct Enemy {}
pub fn setup_enemy(mut commands: Commands, asset_server: Res<AssetServer>) {
    let ship_handle = asset_server.load("textures/ship_C.png");
    commands
        .spawn_bundle(SpriteBundle {
            texture: ship_handle,
            transform: Transform::from_translation(Vec3::splat(50.0)),
            ..default()
        })
        .insert(Enemy {})
        .insert(ConstrainToBounds {})
        .insert(Collider::cuboid(20.0, 10.0))
        .insert(ActiveEvents::COLLISION_EVENTS)
        .insert(ActiveEvents::CONTACT_FORCE_EVENTS)
        .insert(RigidBody::Dynamic)
        .insert(Velocity {
            linvel: Default::default(),
            angvel: 10.0,
        });
}
