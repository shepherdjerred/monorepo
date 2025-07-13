use bevy::prelude::*;

use crate::components::{
    moving::Facing, moving::Moving, moving::State, player::Player, position::Position,
};

pub fn character_movement(
    keyboard_input: Res<Input<KeyCode>>,
    mut query: Query<(&mut Position, &mut Moving, With<Player>)>,
) {
    let factor = 5.;
    for (mut position, mut moving, _) in query.iter_mut() {
        if keyboard_input.pressed(KeyCode::Right) {
            position.x += factor;
            moving.state = State::Walk;
            moving.facing = Facing::Right;
            return;
        }

        if keyboard_input.pressed(KeyCode::Left) {
            position.x -= factor;
            moving.state = State::Walk;
            moving.facing = Facing::Left;
            return;
        }

        if keyboard_input.pressed(KeyCode::Down) {
            position.y -= factor;
            moving.state = State::Walk;
            moving.facing = Facing::Down;
            return;
        }

        if keyboard_input.pressed(KeyCode::Up) {
            position.y += factor;
            moving.state = State::Walk;
            moving.facing = Facing::Up;
            return;
        }

        moving.state = State::Stand;
    }
}
