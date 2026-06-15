use bevy::prelude::Component;

#[derive(Component)]
pub struct Item {
    pub first_attribute: ItemAttribute,
    pub second_attribute: ItemAttribute,
    pub third_attribute: ItemAttribute,
    pub modifier_a: i8,
    pub modifier_b: i8,
    pub modifier_c: i8,
}

pub enum ItemAttribute {}
