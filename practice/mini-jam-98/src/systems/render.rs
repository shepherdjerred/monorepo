use bevy::prelude::*;

use crate::components::{
    health::Health, moving::Facing, moving::Moving, moving::State, player::Player,
    position::Position,
};

pub fn render_player(
    mut query: Query<(
        &mut Position,
        &mut Moving,
        &mut Transform,
        &mut TextureAtlasSprite,
        With<Player>,
    )>,
) {
    let (position, mut moving, mut transform, mut sprite, _) = query.single_mut();

    let facing_offset = str_facing(moving.facing);
    let offset = 6 + (facing_offset * 12);
    let frame = next_frame(moving.state, moving.frame);
    moving.frame = frame;
    let adjusted_index: usize = (moving.frame + offset).try_into().unwrap();
    sprite.index = adjusted_index;
    transform.translation.x = position.x;
    transform.translation.y = position.y;
}

fn next_frame(state: State, frame: i8) -> i8 {
    let max = max_frames(state);
    if frame >= max - 1 {
        return 0;
    } else {
        return frame + 1;
    }
}

fn max_frames(state: State) -> i8 {
    return match state {
        State::Walk => 3,
        _ => 1,
    };
}

fn str_facing(facing: Facing) -> i8 {
    return match facing {
        Facing::Left => 1,
        Facing::Right => 2,
        Facing::Up => 3,
        Facing::Down => 0,
    };
}

fn format_health(health: Health) -> String {
    return format!("{}/{}", health.current, health.max);
}
