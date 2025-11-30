const API_BASE = import.meta.env.PUBLIC_API_URL || "http://localhost:3001/api";

export interface Campground {
  id: string;
  name: string;
  description: string;
  facilityId: string;
  latitude: number;
  longitude: number;
  city: string;
  state: string;
  reservationUrl: string;
  imageUrl?: string;
}

export interface Campsite {
  id: string;
  campgroundId: string;
  name: string;
  siteType: string;
  loop: string;
  maxOccupancy: number;
  isAccessible: boolean;
  hasElectric: boolean;
}

export interface Watch {
  id: string;
  userId: string;
  campgroundId?: string;
  campsiteId?: string;
  startDate: string;
  endDate: string;
  minNights: number;
  isActive: boolean;
}

export interface Alert {
  id: string;
  watchId: string;
  campsiteId: string;
  availableDates: string;
  status: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name?: string;
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || "API request failed");
  }

  return data.data;
}

// Campground APIs
export async function searchCampgrounds(
  query: string
): Promise<Campground[]> {
  return fetchApi(`/campgrounds/search?q=${encodeURIComponent(query)}&state=WA`);
}

export async function getCampgrounds(): Promise<Campground[]> {
  return fetchApi("/campgrounds");
}

export async function importCampground(
  facilityId: string
): Promise<Campground> {
  return fetchApi(`/campgrounds/import/${facilityId}`, { method: "POST" });
}

export async function getCampsites(campgroundId: string): Promise<Campsite[]> {
  return fetchApi(`/campgrounds/${campgroundId}/campsites`);
}

// User APIs
export async function authUser(email: string, name?: string): Promise<User> {
  return fetchApi("/users/auth", {
    method: "POST",
    body: JSON.stringify({ email, name }),
  });
}

export async function updatePreferences(
  userId: string,
  preferences: Record<string, unknown>
): Promise<User> {
  return fetchApi(`/users/${userId}/preferences`, {
    method: "PATCH",
    body: JSON.stringify(preferences),
  });
}

// Watch APIs
export async function getWatches(userId: string): Promise<Watch[]> {
  return fetchApi(`/watches/user/${userId}`);
}

export async function createWatch(watch: Partial<Watch>): Promise<Watch> {
  return fetchApi("/watches", {
    method: "POST",
    body: JSON.stringify(watch),
  });
}

export async function updateWatch(
  id: string,
  updates: Partial<Watch>
): Promise<Watch> {
  return fetchApi(`/watches/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function deleteWatch(id: string): Promise<void> {
  return fetchApi(`/watches/${id}`, { method: "DELETE" });
}

// Alert APIs
export async function getAlerts(userId: string): Promise<Alert[]> {
  return fetchApi(`/alerts/user/${userId}`);
}

export async function dismissAlert(id: string): Promise<Alert> {
  return fetchApi(`/alerts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "dismissed" }),
  });
}

// Availability APIs
export async function refreshAvailability(
  facilityId: string,
  months?: number
): Promise<{ recordsUpdated: number }> {
  return fetchApi(`/availability/refresh/${facilityId}`, {
    method: "POST",
    body: JSON.stringify({ months }),
  });
}

export async function searchAvailability(params: {
  campgroundId: string;
  startDate: string;
  endDate: string;
  minNights?: number;
}): Promise<
  Array<{
    campsite: Campsite;
    availableSequences: string[][];
  }>
> {
  const searchParams = new URLSearchParams({
    campgroundId: params.campgroundId,
    startDate: params.startDate,
    endDate: params.endDate,
    minNights: String(params.minNights || 1),
  });
  return fetchApi(`/availability/search?${searchParams}`);
}
