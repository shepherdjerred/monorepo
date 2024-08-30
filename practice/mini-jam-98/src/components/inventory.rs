use crate::components::item::Item;
use bevy::prelude::Component;

#[derive(Component)]
pub struct Inventory {
    pub items: [Item],
}
