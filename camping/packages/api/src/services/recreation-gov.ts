import {
  RECREATION_GOV_API_BASE,
  retryWithBackoff,
  type Campground,
  type Campsite,
  type Availability,
  type AvailabilityStatus,
  formatDate,
  generateId,
} from "@camping/shared";

interface RecGovFacility {
  FacilityID: string;
  FacilityName: string;
  FacilityDescription: string;
  FacilityLatitude: number;
  FacilityLongitude: number;
  FacilityAdaAccess: string;
  FacilityReservationURL: string;
  GEOJSON: {
    COORDINATES: [number, number];
  };
  FACILITY: {
    FacilityName: string;
  };
  RECAREA: Array<{
    RecAreaID: string;
    RecAreaName: string;
  }>;
  CAMPSITE: Array<RecGovCampsite>;
}

interface RecGovCampsite {
  CampsiteID: string;
  CampsiteName: string;
  CampsiteType: string;
  Loop: string;
  TypeOfUse: string;
  MaxNumOfPeople: number;
  MaxVehicleLength: number;
  CampsiteAccessible: boolean;
  ATTRIBUTES: Array<{
    AttributeName: string;
    AttributeValue: string;
  }>;
  PERMITTEDEQUIPMENT: Array<{
    EquipmentName: string;
    MaxLength: number;
  }>;
}

interface RecGovAvailability {
  campsites: Record<
    string,
    {
      campsite_id: string;
      site: string;
      loop: string;
      campsite_type: string;
      availabilities: Record<string, string>;
    }
  >;
}

const USER_AGENT =
  "CampingNotifier/1.0 (Washington State Campsite Availability Checker)";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Search for campgrounds in Recreation.gov
 */
export async function searchCampgrounds(
  query: string,
  state: string = "WA"
): Promise<Campground[]> {
  const url = `${RECREATION_GOV_API_BASE}/search?q=${encodeURIComponent(query)}&state=${state}&entity_type=campground&size=50`;

  try {
    const data = await retryWithBackoff(() =>
      fetchJson<{
        results: Array<{
          entity_id: string;
          name: string;
          description: string;
          latitude: number;
          longitude: number;
          city: string;
          state: string;
          preview_image_url: string;
        }>;
      }>(url)
    );

    return data.results.map((result) => ({
      id: generateId(),
      name: result.name,
      description: result.description || "",
      facilityId: result.entity_id,
      latitude: result.latitude,
      longitude: result.longitude,
      address: "",
      city: result.city || "",
      state: result.state || state,
      reservationUrl: `https://www.recreation.gov/camping/campgrounds/${result.entity_id}`,
      imageUrl: result.preview_image_url,
      amenities: [],
      source: "recreation_gov" as const,
    }));
  } catch (error) {
    console.error("Error searching campgrounds:", error);
    return [];
  }
}

/**
 * Get detailed facility information
 */
export async function getFacilityDetails(
  facilityId: string
): Promise<Campground | null> {
  const url = `${RECREATION_GOV_API_BASE}/camps/campgrounds/${facilityId}`;

  try {
    const data = await retryWithBackoff(() =>
      fetchJson<{
        campground: {
          facility_id: string;
          facility_name: string;
          facility_description: string;
          facility_latitude: number;
          facility_longitude: number;
          facility_address1: string;
          facility_address2: string;
          city: string;
          state: string;
          facility_photo_url: string;
          amenities: string[];
        };
      }>(url)
    );

    const facility = data.campground;
    return {
      id: generateId(),
      name: facility.facility_name,
      description: facility.facility_description || "",
      facilityId: facility.facility_id,
      latitude: facility.facility_latitude,
      longitude: facility.facility_longitude,
      address: [facility.facility_address1, facility.facility_address2]
        .filter(Boolean)
        .join(", "),
      city: facility.city || "",
      state: facility.state || "WA",
      reservationUrl: `https://www.recreation.gov/camping/campgrounds/${facilityId}`,
      imageUrl: facility.facility_photo_url,
      amenities: facility.amenities || [],
      source: "recreation_gov" as const,
    };
  } catch (error) {
    console.error(`Error fetching facility ${facilityId}:`, error);
    return null;
  }
}

/**
 * Get campsites for a facility
 */
export async function getCampsites(facilityId: string): Promise<Campsite[]> {
  const url = `${RECREATION_GOV_API_BASE}/camps/campgrounds/${facilityId}/campsites`;

  try {
    const data = await retryWithBackoff(() =>
      fetchJson<{
        campsites: Array<{
          campsite_id: string;
          campsite_name: string;
          campsite_type: string;
          loop: string;
          max_num_people: number;
          max_vehicle_length: number;
          campsite_accessible: boolean;
          campsite_equipment_name: string;
          campsite_use_type: string;
          attributes: Record<string, string>;
        }>;
      }>(url)
    );

    return data.campsites.map((site) => {
      const siteType = mapSiteType(site.campsite_type);
      return {
        id: site.campsite_id,
        campgroundId: facilityId,
        name: site.campsite_name,
        siteType,
        loop: site.loop || "",
        maxOccupancy: site.max_num_people || 6,
        maxVehicles: 2,
        isAccessible: site.campsite_accessible || false,
        hasElectric: site.attributes?.["Electricity Hookup"] === "Yes",
        hasWater: site.attributes?.["Water Hookup"] === "Yes",
        hasSewer: site.attributes?.["Sewer Hookup"] === "Yes",
        isPetsAllowed: site.attributes?.["Pets Allowed"] !== "No",
      };
    });
  } catch (error) {
    console.error(`Error fetching campsites for ${facilityId}:`, error);
    return [];
  }
}

/**
 * Get availability for a campground for a specific month
 */
export async function getAvailability(
  facilityId: string,
  startDate: Date
): Promise<Availability[]> {
  // Recreation.gov API uses first day of month format
  const year = startDate.getFullYear();
  const month = String(startDate.getMonth() + 1).padStart(2, "0");
  const url = `${RECREATION_GOV_API_BASE}/camps/availability/campground/${facilityId}/month?start_date=${year}-${month}-01T00:00:00.000Z`;

  try {
    const data = await retryWithBackoff(() =>
      fetchJson<RecGovAvailability>(url)
    );

    const availabilities: Availability[] = [];
    const checkedAt = new Date().toISOString();

    for (const [campsiteId, siteData] of Object.entries(data.campsites)) {
      for (const [dateStr, status] of Object.entries(siteData.availabilities)) {
        // dateStr is in format "2024-01-01T00:00:00Z"
        const date = dateStr.split("T")[0];
        availabilities.push({
          campsiteId,
          date,
          status: mapAvailabilityStatus(status),
          checkedAt,
        });
      }
    }

    return availabilities;
  } catch (error) {
    console.error(`Error fetching availability for ${facilityId}:`, error);
    return [];
  }
}

function mapSiteType(recGovType: string): Campsite["siteType"] {
  const type = recGovType.toLowerCase();
  if (type.includes("tent")) return "tent";
  if (type.includes("rv") || type.includes("trailer")) return "rv";
  if (type.includes("cabin")) return "cabin";
  if (type.includes("yurt")) return "yurt";
  if (type.includes("group")) return "group";
  if (type.includes("equestrian") || type.includes("horse")) return "equestrian";
  if (type.includes("boat")) return "boat";
  return "other";
}

function mapAvailabilityStatus(status: string): AvailabilityStatus {
  switch (status.toLowerCase()) {
    case "available":
      return "available";
    case "reserved":
      return "reserved";
    case "not reservable":
    case "not available":
      return "not_reservable";
    case "open":
    case "first come first served":
      return "first_come_first_served";
    default:
      return "unknown";
  }
}
