use crate::bounds::TrackOutOfBounds;
use crate::player::PlayerCharacter;
use crate::weapons::Weapon;
use bevy::prelude::*;
use bevy::sprite::MaterialMesh2dBundle;
use bevy_rapier2d::prelude::*;
use std::ops::{Add, Mul};

#[derive(Component)]
pub struct Missile {}

pub fn player_shoot_missile_system(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<ColorMaterial>>,
    keyboard_input: Res<Input<KeyCode>>,
    mut query: Query<(&PlayerCharacter, &mut Weapon, &Transform, &Velocity)>,
) {
    let (_, mut weapon, transform, velocity) = query.single_mut();

    if keyboard_input.pressed(KeyCode::Space) {
        if weapon.remaining_reload_time > 0.0 {
            return;
        }

        weapon.remaining_reload_time = weapon.reload_speed;

        commands
            .spawn_bundle(MaterialMesh2dBundle {
                mesh: meshes.add(Mesh::from(shape::Quad::default())).into(),
                transform: Transform::from_translation(transform.translation.add(10.0))
                    .with_rotation(transform.rotation)
                    .with_scale(Vec3::splat(weapon.size)),
                material: materials.add(ColorMaterial::from(Color::BLACK)),
                ..default()
            })
            .insert(Missile {})
            .insert(TrackOutOfBounds {})
            .insert(Collider::cuboid(weapon.size / 4.5, weapon.size / 4.5))
            .insert(ActiveEvents::COLLISION_EVENTS)
            .insert(RigidBody::Dynamic)
            .insert(Velocity {
                linvel: velocity.linvel.mul(Vec2::splat(50.0)),
                angvel: velocity.angvel,
            })
            .insert(ColliderMassProperties::Density(4.0))
            .insert(ActiveEvents::CONTACT_FORCE_EVENTS);
    }
}

pub fn display_events(
    mut collision_events: EventReader<CollisionEvent>,
    mut contact_force_events: EventReader<ContactForceEvent>,
) {
    for collision_event in collision_events.iter() {
        // println!("Received collision event: {:?}", collision_event);
    }

    for contact_force_event in contact_force_events.iter() {
        // println!("Received contact force event: {:?}", contact_force_event);
    }
}
