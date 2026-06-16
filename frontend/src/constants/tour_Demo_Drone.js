import { flightStatus } from './drones_data';

export const TOUR_DEMO_DRONE_ID = -919191;
export function getTourDemoDrone() {
  const p0 = [44.605443, 33.522084];
  const p1 = [44.6062, 33.5231];
  const p2 = [44.6068, 33.524];
  return {
    id: TOUR_DEMO_DRONE_ID,
    name: 'Дрон (обзор)',
    type: 'quadcopter',
    isVisible: true,
    position: { lat: 44.6082, lng: 33.5265 },
    path: [p0, p1, p2],
    flightStatus: flightStatus.IDLE,
    isFlying: false,
    status: 'на земле',
    battery: 88,
    flightProgress: 0,
    maxSpeed: 70,
    missionParameters: {
      totalDistance: 320,
      estimatedTime: 210,
      batteryConsumption: 14,
    },
  };
}

export function isTourDemoDrone(drone) {
  return drone?.id === TOUR_DEMO_DRONE_ID;
}
