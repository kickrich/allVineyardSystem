export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export const calculateFlightTime = (distance, speed) => {
  if (speed <= 0) return 0;
  return distance / speed;
};

export const getIntermediatePoint = (start, end, progress) => {
  const lat = start[0] + (end[0] - start[0]) * progress;
  const lng = start[1] + (end[1] - start[1]) * progress;
  return [lat, lng];
};

export const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  
  return (θ * 180 / Math.PI + 360) % 360;
};

export const calculateOptimalSpeed = (distance, maxSpeed = 15) => {
  if (distance < 100) return 5;
  if (distance < 1000) return 10;
  return maxSpeed;
};

export function getFirstWaypointCoords(drone) {
  if (!drone?.path?.length) return null;
  const first = drone.path[0];
  if (!Array.isArray(first) || first.length < 2) return null;
  const lat = Number(first[0]);
  const lng = Number(first[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function getDistanceToFirstWaypoint(drone) {
  if (!drone?.path || drone.path.length < 2 || !drone.position) return null;
  const firstCoords = getFirstWaypointCoords(drone);
  if (!firstCoords) return null;
  const lat = Number(drone.position.lat);
  const lng = Number(drone.position.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return calculateDistance(lat, lng, firstCoords.lat, firstCoords.lng);
}