import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use the same database as the API
const dbPath =
  process.env.DATABASE_PATH ||
  path.join(__dirname, "../../api/data/camping.db");

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

// Schema (copied from API to avoid cross-package imports at runtime)
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
  amenities: text("amenities").notNull().default("[]"),
  source: text("source").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const campsites = sqliteTable("campsites", {
  id: text("id").primaryKey(),
  campgroundId: text("campground_id").notNull(),
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
  campsiteId: text("campsite_id").notNull(),
  date: text("date").notNull(),
  status: text("status").notNull(),
  price: real("price"),
  checkedAt: text("checked_at").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  notificationPreferences: text("notification_preferences").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const watches = sqliteTable("watches", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  campgroundId: text("campground_id"),
  campsiteId: text("campsite_id"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  minNights: integer("min_nights").notNull().default(1),
  flexibleDates: integer("flexible_dates", { mode: "boolean" })
    .notNull()
    .default(false),
  siteTypes: text("site_types"),
  requiresAccessible: integer("requires_accessible", { mode: "boolean" }),
  requiresElectric: integer("requires_electric", { mode: "boolean" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  watchId: text("watch_id").notNull(),
  userId: text("user_id").notNull(),
  campsiteId: text("campsite_id").notNull(),
  availableDates: text("available_dates").notNull(),
  status: text("status").notNull(),
  sentAt: text("sent_at"),
  createdAt: text("created_at").notNull(),
});

export const db = drizzle(sqlite, {
  schema: { campgrounds, campsites, availability, users, watches, alerts },
});
