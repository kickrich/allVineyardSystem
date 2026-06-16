import { dronesData, flightStatus } from '../constants/drones_data.js';

export function withRuntimeState(drone) {
  const path = normalizeRoutePath(drone?.path);
  const hasPosition = Number.isFinite(Number(drone?.position?.lat)) && Number.isFinite(Number(drone?.position?.lng));
  return {
    ...drone,
    position: hasPosition ? { lat: Number(drone.position.lat), lng: Number(drone.position.lng) } : null,
    path,
    isVisible: Boolean(drone?.isVisible),
    battery: drone.battery ?? 100,
    status: 'на земле',
    flightStatus: flightStatus.IDLE,
    speed: 0,
    altitude: 0,
    heading: 0,
    totalDistance: 0,
    currentMission: null,
    flightProgress: 0,
    remainingBattery: 5,
    estimatedFlightTime: 0,
    currentWaypointIndex: 0,
    missionTimerId: null,
    missionStartTime: null,
    missionElapsedTime: 0,
    missionParameters: null,
    flightLog: []
  };
}

export function normalizeRoutePath(path) {
  if (!Array.isArray(path)) return [];
  return path
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => [Number(point[0]), Number(point[1])])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

export function inferRouteProgressFromPosition(path, position) {
  if (!Array.isArray(path) || path.length < 2 || !position) return null;
  const lat = Number(position.lat);
  const lng = Number(position.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const segments = path.length - 1;
  let best = null;
  let bestDist = Infinity;

  for (let i = 0; i < segments; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;
    const aLat = Number(a[0]);
    const aLng = Number(a[1]);
    const bLat = Number(b[0]);
    const bLng = Number(b[1]);
    if (![aLat, aLng, bLat, bLng].every(Number.isFinite)) continue;
    const latRad = (aLat * Math.PI) / 180;
    const cosLat = Math.cos(latRad) || 1e-6;
    const mPerLat = 111_320;
    const mPerLng = 111_320 * cosLat;

    const ax = 0;
    const ay = 0;
    const bx = (bLng - aLng) * mPerLng;
    const by = (bLat - aLat) * mPerLat;
    const px = (lng - aLng) * mPerLng;
    const py = (lat - aLat) * mPerLat;

    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-9) {
      t = ((px - ax) * dx + (py - ay) * dy) / len2;
    }
    t = Math.max(0, Math.min(1, t));

    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const dist = Math.hypot(px - cx, py - cy);

    if (dist < bestDist) {
      bestDist = dist;
      best = { segmentIndex: i, t };
    }
  }

  if (!best) return null;
  const progress = ((best.segmentIndex + best.t) / segments) * 100;
  return {
    segmentIndex: best.segmentIndex,
    segmentT: best.t,
    progress: Math.max(0, Math.min(100, progress)),
  };
}

export function normalizeShiftSegmentIndices(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw
    .map((i) => Number(i))
    .filter((i) => Number.isInteger(i) && i >= 0))]
    .sort((a, b) => a - b);
}

export function createLocalDrones() {
  return dronesData.map((drone) => withRuntimeState({ ...drone }));
}

export function mapBackendDroneToFrontend(drone, index) {
  const fallback = dronesData[index % dronesData.length] ?? {};
  const batteryValue = Number(drone?.battery);
  const lat = Number(drone?.latitude);
  const lng = Number(drone?.longitude);
  const isVisible = Boolean(drone?.is_visible);
  const routePath = normalizeRoutePath(drone?.route_path);
  const shiftSegmentIndices = normalizeShiftSegmentIndices(drone?.shift_segment_indices);
  return withRuntimeState({
    ...fallback,
    id: drone?.id ?? fallback.id ?? index + 1,
    name: drone?.name ?? fallback.name ?? `Дрон-${index + 1}`,
    model: drone?.model ?? fallback.model ?? 'Generic',
    battery: Number.isFinite(batteryValue) ? batteryValue : (fallback.battery ?? 100),
    backendStatus: drone?.status ?? 'idle',
    isVisible,
    position: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null,
    path: routePath,
    shiftSegmentIndices,
  });
}
