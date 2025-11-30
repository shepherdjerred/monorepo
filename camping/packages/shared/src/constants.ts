// Constants for camping reservation system

export const RECREATION_GOV_API_BASE = "https://www.recreation.gov/api";

export const WA_STATE_PARKS_URL = "https://washington.goingtocamp.com";

// Washington state campgrounds on Recreation.gov
// These are popular federal campgrounds in Washington
export const POPULAR_WA_CAMPGROUNDS = [
  { facilityId: "232267", name: "Ohanapecosh Campground" }, // Mt Rainier
  { facilityId: "232268", name: "Cougar Rock Campground" }, // Mt Rainier
  { facilityId: "232269", name: "White River Campground" }, // Mt Rainier
  { facilityId: "232464", name: "Kalaloch Campground" }, // Olympic
  { facilityId: "232465", name: "Mora Campground" }, // Olympic
  { facilityId: "232466", name: "Sol Duc Campground" }, // Olympic
  { facilityId: "232462", name: "Heart O' the Hills Campground" }, // Olympic
  { facilityId: "232099", name: "Colonial Creek South Campground" }, // North Cascades
  { facilityId: "232100", name: "Newhalem Creek Campground" }, // North Cascades
  { facilityId: "232101", name: "Goodell Creek Campground" }, // North Cascades
  { facilityId: "234059", name: "Hoh Campground" }, // Olympic
] as const;

// Availability check intervals
export const CHECK_INTERVALS = {
  HIGH_PRIORITY: 5 * 60 * 1000, // 5 minutes
  NORMAL: 15 * 60 * 1000, // 15 minutes
  LOW_PRIORITY: 60 * 60 * 1000, // 1 hour
} as const;

// Maximum watches per user
export const MAX_WATCHES_PER_USER = 20;

// Maximum date range for a single watch
export const MAX_WATCH_DATE_RANGE_DAYS = 90;

// Site type display names
export const SITE_TYPE_LABELS: Record<string, string> = {
  tent: "Tent",
  rv: "RV/Trailer",
  cabin: "Cabin",
  yurt: "Yurt",
  group: "Group Site",
  equestrian: "Equestrian",
  boat: "Boat-in",
  other: "Other",
};

// Amenity icons (for UI)
export const AMENITY_ICONS: Record<string, string> = {
  electric: "⚡",
  water: "💧",
  sewer: "🚿",
  accessible: "♿",
  pets: "🐕",
  wifi: "📶",
  showers: "🚿",
  toilets: "🚻",
  campfire: "🔥",
  picnic: "🏕️",
};
