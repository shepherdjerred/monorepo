// The eight Hoenn gym badges in FLAG_BADGE01_GET..FLAG_BADGE08_GET order,
// with the gym leader and city for the notification text.

export type BadgeInfo = {
  name: string;
  leader: string;
  city: string;
};

export const BADGES: readonly BadgeInfo[] = [
  { name: "Stone Badge", leader: "Roxanne", city: "Rustboro City" },
  { name: "Knuckle Badge", leader: "Brawly", city: "Dewford Town" },
  { name: "Dynamo Badge", leader: "Wattson", city: "Mauville City" },
  { name: "Heat Badge", leader: "Flannery", city: "Lavaridge Town" },
  { name: "Balance Badge", leader: "Norman", city: "Petalburg City" },
  { name: "Feather Badge", leader: "Winona", city: "Fortree City" },
  { name: "Mind Badge", leader: "Tate & Liza", city: "Mossdeep City" },
  { name: "Rain Badge", leader: "Wallace", city: "Sootopolis City" },
];
