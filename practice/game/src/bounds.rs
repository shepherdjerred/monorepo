use crate::BOUNDS;
use bevy::prelude::*;

#[derive(Component)]
pub struct ConstrainToBounds {}

#[derive(Component)]
pub struct TrackOutOfBounds {}

#[derive(Component)]
pub struct IsOutOfBounds {}

pub fn constrained_to_bounds_system(mut query: Query<(&ConstrainToBounds, &mut Transform)>) {
    query.for_each_mut(|item| {
        let (_, mut transform) = item;
        let extents = Vec3::from((BOUNDS / 2.0, 100.0));
        transform.translation = transform.translation.min(extents).max(-extents);
    })
}

pub fn track_out_of_bounds_system(
    mut commands: Commands,
    mut query: Query<(Entity, &TrackOutOfBounds, &Transform)>,
) {
    query.for_each_mut(|item| {
        let (entity, _, transform) = item;
        let extents = Vec3::from((BOUNDS / 2.0, 100.0));
        if transform.translation.cmpgt(extents).any() || transform.translation.cmplt(-extents).any()
        {
            commands.entity(entity).insert(IsOutOfBounds {});
        }
    })
}

pub fn despawn_out_of_bounds_system(
    mut commands: Commands,
    query: Query<Entity, With<IsOutOfBounds>>,
) {
    for entity in &query {
        commands.entity(entity).despawn();
    }
}
