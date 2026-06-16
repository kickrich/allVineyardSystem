import {
  calculateDistance,
  calculateFlightTime,
  calculateOptimalSpeed,
} from './flight_Calculator';

export function computeMissionParamsFromPath(path, maxSpeed = 70, battery = 100) {
  if (!path || path.length < 2) return null;

  let totalDistance = 0;
  const distances = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [lat1, lng1] = path[i];
    const [lat2, lng2] = path[i + 1];
    const distance = calculateDistance(lat1, lng1, lat2, lng2);
    totalDistance += distance;
    distances.push(distance);
  }

  const optimalSpeed = calculateOptimalSpeed(totalDistance, maxSpeed / 3.6);
  const flightTime = calculateFlightTime(totalDistance, optimalSpeed);
  const batteryConsumption = Math.min(totalDistance / 100, battery - 10);

  const missionParams = {
    totalDistance: Math.round(totalDistance),
    optimalSpeed: Math.round(optimalSpeed * 3.6),
    estimatedTime: Math.round(flightTime),
    batteryConsumption: Math.round(batteryConsumption),
    waypoints: path.length,
    distances,
    segmentTimes: distances.map((d) => Math.max(1000, (d / optimalSpeed) * 1000)),
    totalTime: 0,
  };
  missionParams.totalTime = missionParams.segmentTimes.reduce((sum, t) => sum + t, 0);
  return missionParams;
}
