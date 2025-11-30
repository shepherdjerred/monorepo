import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const campgrounds = sqliteTable("campgrounds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  facilityId: text("facility_id").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default("WA"),
  reservationUrl: text("reservation_url").notNull(),
  imageUrl: text("image_url"),
  amenities: text("amenities").notNull().default("[]"), // JSON array
  source: text("source").notNull().$type<"recreation_gov" | "wa_state_parks">(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const campsites = sqliteTable("campsites", {
  id: text("id").primaryKey(),
  campgroundId: text("campground_id")
    .notNull()
    .references(() => campgrounds.id),
  name: text("name").notNull(),
  siteType: text("site_type").notNull(),
  loop: text("loop").notNull().default(""),
  maxOccupancy: integer("max_occupancy").notNull().default(6),
  maxVehicles: integer("max_vehicles").notNull().default(2),
  isAccessible: integer("is_accessible", { mode: "boolean" })
    .notNull()
    .default(false),
  hasElectric: integer("has_electric", { mode: "boolean" })
    .notNull()
    .default(false),
  hasWater: integer("has_water", { mode: "boolean" }).notNull().default(false),
  hasSewer: integer("has_sewer", { mode: "boolean" }).notNull().default(false),
  isPetsAllowed: integer("is_pets_allowed", { mode: "boolean" })
    .notNull()
    .default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const availability = sqliteTable("availability", {
  id: text("id").primaryKey(),
  campsiteId: text("campsite_id")
    .notNull()
    .references(() => campsites.id),
  date: text("date").notNull(), // YYYY-MM-DD
  status: text("status")
    .notNull()
    .$type<
      | "available"
      | "reserved"
      | "not_reservable"
      | "first_come_first_served"
      | "unknown"
    >(),
  price: real("price"),
  checkedAt: text("checked_at").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  notificationPreferences: text("notification_preferences").notNull(), // JSON
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const watches = sqliteTable("watches", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  campgroundId: text("campground_id").references(() => campgrounds.id),
  campsiteId: text("campsite_id").references(() => campsites.id),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  minNights: integer("min_nights").notNull().default(1),
  flexibleDates: integer("flexible_dates", { mode: "boolean" })
    .notNull()
    .default(false),
  siteTypes: text("site_types"), // JSON array
  requiresAccessible: integer("requires_accessible", { mode: "boolean" }),
  requiresElectric: integer("requires_electric", { mode: "boolean" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  watchId: text("watch_id")
    .notNull()
    .references(() => watches.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  campsiteId: text("campsite_id")
    .notNull()
    .references(() => campsites.id),
  availableDates: text("available_dates").notNull(), // JSON array
  status: text("status")
    .notNull()
    .$type<"pending" | "sent" | "dismissed" | "expired">(),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull(),
});
