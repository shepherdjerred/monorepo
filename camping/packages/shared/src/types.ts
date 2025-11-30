// Core domain types for camping reservation system

export interface Campground {
  id: string;
  name: string;
  description: string;
  facilityId: string; // Recreation.gov facility ID
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  state: string;
  reservationUrl: string;
  imageUrl?: string;
  amenities: string[];
  source: "recreation_gov" | "wa_state_parks";
}

export interface Campsite {
  id: string;
  campgroundId: string;
  name: string;
  siteType: CampsiteType;
  loop: string;
  maxOccupancy: number;
  maxVehicles: number;
  isAccessible: boolean;
  hasElectric: boolean;
  hasWater: boolean;
  hasSewer: boolean;
  isPetsAllowed: boolean;
}

export type CampsiteType =
  | "tent"
  | "rv"
  | "cabin"
  | "yurt"
  | "group"
  | "equestrian"
  | "boat"
  | "other";

export interface Availability {
  campsiteId: string;
  date: string; // ISO date string YYYY-MM-DD
  status: AvailabilityStatus;
  price?: number;
  checkedAt: string; // ISO timestamp
}

export type AvailabilityStatus =
  | "available"
  | "reserved"
  | "not_reservable"
  | "first_come_first_served"
  | "unknown";

export interface Watch {
  id: string;
  userId: string;
  campgroundId?: string;
  campsiteId?: string;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  minNights: number;
  flexibleDates: boolean;
  siteTypes?: CampsiteType[];
  requiresAccessible?: boolean;
  requiresElectric?: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  watchId: string;
  userId: string;
  campsiteId: string;
  availableDates: string[]; // Array of ISO date strings
  status: AlertStatus;
  sentAt?: string;
  createdAt: string;
}

export type AlertStatus = "pending" | "sent" | "dismissed" | "expired";

export interface User {
  id: string;
  email: string;
  name?: string;
  notificationPreferences: NotificationPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPreferences {
  email: boolean;
  emailAddress?: string;
  push: boolean;
  pushSubscription?: PushSubscription;
  quietHoursStart?: string; // HH:MM format
  quietHoursEnd?: string; // HH:MM format
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Search/filter types
export interface CampgroundSearchParams {
  query?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  radiusMiles?: number;
  amenities?: string[];
  source?: Campground["source"];
}

export interface AvailabilitySearchParams {
  campgroundId?: string;
  campsiteIds?: string[];
  startDate: string;
  endDate: string;
  minNights?: number;
  siteTypes?: CampsiteType[];
}
