export const MOTION_LIGHT_ROOMS = {
  laundry: {
    motionEntityId: "binary_sensor.laundry_multisensor_motion_detection",
    lightEntityId: "switch.laundry_light",
  },
  storage: {
    motionEntityId: "binary_sensor.storage_multisensor_motion_detection",
    lightEntityId: "switch.storage_light",
  },
} as const;

export type MotionLightRoom = keyof typeof MOTION_LIGHT_ROOMS;
