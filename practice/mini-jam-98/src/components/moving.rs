use bevy::prelude::Component;

#[derive(Component, Copy, Clone, Debug)]
pub struct Moving {
    pub facing: Facing,
    pub state: State,
    pub frame: i8,
}
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum Facing {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Copy, Clone, Debug, PartialEq)]
pub enum State {
    Stand,
    Walk,
    Laugh,
    Nod,
    Pose,
    Shake,
    Surprise,
}
