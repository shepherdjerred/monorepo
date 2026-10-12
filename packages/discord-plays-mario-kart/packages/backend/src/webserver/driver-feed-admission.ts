// Mario Kart's driver-feed policy: the feed is for seated drivers only. The
// page names its Socket.IO connection in the `driverSocketId` query parameter,
// and that connection must hold a seat — both when the feed socket opens and
// before every access unit, so releasing a seat ends the picture.
import type { DriverFeedAdmit } from "@shepherdjerred/discord-plays-core/driver-feed/service.ts";

export const DRIVER_SEAT_REQUIRED = "an active driver seat is required";

export function seatAdmission(
  isActiveDriver: (socketId: string) => boolean,
): DriverFeedAdmit {
  return (request) => {
    const socketId = URL.parse(
      request.url ?? "/",
      "http://localhost",
    )?.searchParams.get("driverSocketId");
    if (
      socketId === null ||
      socketId === undefined ||
      !isActiveDriver(socketId)
    ) {
      return { admitted: false, reason: DRIVER_SEAT_REQUIRED };
    }
    return {
      admitted: true,
      isStillAdmitted: () => isActiveDriver(socketId),
    };
  };
}
