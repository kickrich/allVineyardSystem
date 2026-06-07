import { useEffect, useMemo, useRef, useState } from 'react';
import { flightStatus } from '../constants/drones_data';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM } from '../constants/app';
import { RouteShiftSegmentsPopup } from './Route_Shift_Segments_Popup';

if (typeof window !== 'undefined') {
  if (!window.yandexMapsLoading) window.yandexMapsLoading = false;
  if (!window.yandexMapsLoaded) window.yandexMapsLoaded = false;
}

/** Длительность плавного подгона вида при смене зоны (мс). */
const ZONE_FIT_ANIMATION_MS = 520;

/** Появление / исчезновение маркера: длина диагонали по земле (м) и длительность (мс), симметрично. */
const DRONE_PLACE_OFFSET_M = 72;
const DRONE_PLACE_DURATION_MS = 400;

const OSM_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const BUILDINGS_REFRESH_DEBOUNCE_MS = 200;
/** Крупные полигоны OSM (кварталы/зоны) не считаем отдельным зданием для проверки маршрута. */
const MAX_BUILDING_FOOTPRINT_AREA_M2 = 25_000;

const YANDEX_MAP_TYPE_SATELLITE = 'yandex#satellite';
const YANDEX_MAP_TYPE_SCHEME = 'yandex#map';

function applyYandexZoomRangeForType(map, mapType, center) {
  if (!map || typeof window.ymaps?.getZoomRange !== 'function') return;
  const coords = Array.isArray(center) && center.length >= 2 ? center : null;
  if (!coords) return;
  window.ymaps
    .getZoomRange(mapType, coords)
    .then((range) => {
      if (!map) return;
      const minZ = Number(range?.[0]);
      const maxZ = Number(range?.[1]);
      if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) return;
      map.options.set({
        minZoom: Math.max(MAP_MIN_ZOOM, minZ),
        maxZoom: Math.min(MAP_MAX_ZOOM, maxZ),
      });
    })
    .catch(() => {});
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

/** Полёт / миссия: нельзя тянуть маркер; в sync — жёстко к координатам из props. */
function isDroneFlyingLike(drone) {
  if (!drone) return false;
  if (drone.status === 'в полете') return true;
  if (drone.isFlying) return true;
  const fs = drone.flightStatus;
  return (
    fs === flightStatus.FLYING ||
    fs === flightStatus.TAKEOFF ||
    fs === flightStatus.LANDING ||
    fs === flightStatus.PAUSED
  );
}

/** Сместить точку на offsetM по азимуту: 0 — север, π/2 — восток (случайный угол для прилёта/улёта). */
function offsetLatLngByMetersAndBearing(latDeg, lngDeg, offsetM, bearingRad) {
  const latRad = (latDeg * Math.PI) / 180;
  const cosLat = Math.cos(latRad) || 1e-6;
  const dLat = (offsetM / 111_320) * Math.cos(bearingRad);
  const dLng = (offsetM / (111_320 * cosLat)) * Math.sin(bearingRad);
  return [latDeg + dLat, lngDeg + dLng];
}

/** boundary с API: [[lng, lat], ...] — замкнутый полигон. */
function boundaryToYandexRing(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 4) return null;
  return boundary.map(([lng, lat]) => [lat, lng]);
}

/** Кольцо Яндекс-карт [[lat, lng], ...] -> boundary API [[lng, lat], ...]. */
function yandexRingToBoundary(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const normalized = ring.map((pair) => [pair?.[1], pair?.[0]]);
  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (!first || !last) return null;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    normalized.push([first[0], first[1]]);
  }
  return normalized;
}

function rectCornersToBoundary(cornerA, cornerB) {
  if (!cornerA || !cornerB) return null;
  const minLat = Math.min(cornerA.lat, cornerB.lat);
  const maxLat = Math.max(cornerA.lat, cornerB.lat);
  const minLng = Math.min(cornerA.lng, cornerB.lng);
  const maxLng = Math.max(cornerA.lng, cornerB.lng);
  return [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat],
  ];
}

function computeBoundaryBbox(boundary) {
  if (!Array.isArray(boundary) || boundary.length < 4) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  boundary.forEach(([lng, lat]) => {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    minLat = Math.min(minLat, la);
    maxLat = Math.max(maxLat, la);
    minLng = Math.min(minLng, ln);
    maxLng = Math.max(maxLng, ln);
  });
  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return null;
  if (minLat === maxLat || minLng === maxLng) return null;
  return { south: minLat, west: minLng, north: maxLat, east: maxLng };
}

function metersToLat(m) {
  return m / 111_320;
}

function metersToLng(m, atLatDeg) {
  const latRad = (Number(atLatDeg) * Math.PI) / 180;
  const cosLat = Math.cos(latRad) || 1e-6;
  return m / (111_320 * cosLat);
}

function inflateBbox(bbox, padM = 40) {
  if (!bbox) return null;
  const latMid = (bbox.south + bbox.north) / 2;
  const dLat = metersToLat(padM);
  const dLng = metersToLng(padM, latMid);
  return {
    south: bbox.south - dLat,
    west: bbox.west - dLng,
    north: bbox.north + dLat,
    east: bbox.east + dLng,
  };
}

function orientation(ax, ay, bx, by, cx, cy) {
  const v = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(v) < 1e-12) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(ax, ay, bx, by, cx, cy) {
  return (
    Math.min(ax, bx) - 1e-12 <= cx &&
    cx <= Math.max(ax, bx) + 1e-12 &&
    Math.min(ay, by) - 1e-12 <= cy &&
    cy <= Math.max(ay, by) + 1e-12
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a.x, a.y, b.x, b.y, c.x, c.y);
  const o2 = orientation(a.x, a.y, b.x, b.y, d.x, d.y);
  const o3 = orientation(c.x, c.y, d.x, d.y, a.x, a.y);
  const o4 = orientation(c.x, c.y, d.x, d.y, b.x, b.y);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a.x, a.y, b.x, b.y, c.x, c.y)) return true;
  if (o2 === 0 && onSegment(a.x, a.y, b.x, b.y, d.x, d.y)) return true;
  if (o3 === 0 && onSegment(c.x, c.y, d.x, d.y, a.x, a.y)) return true;
  if (o4 === 0 && onSegment(c.x, c.y, d.x, d.y, b.x, b.y)) return true;
  return false;
}

/** Пересекает ли отрезок маршрута контур здания (только «сквозь» стены, не «точка внутри квартала»). */
function routeSegmentCrossesRing(pointA, pointB, ring) {
  if (!pointA || !pointB || !Array.isArray(ring) || ring.length < 3) return false;
  const a = { x: Number(pointA.lng), y: Number(pointA.lat) };
  const b = { x: Number(pointB.lng), y: Number(pointB.lat) };
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return false;

  for (let i = 0; i < ring.length - 1; i += 1) {
    const p0 = ring[i];
    const p1 = ring[i + 1];
    const c = { x: Number(p0?.[1]), y: Number(p0?.[0]) };
    const d = { x: Number(p1?.[1]), y: Number(p1?.[0]) };
    if (![c.x, c.y, d.x, d.y].every(Number.isFinite)) continue;
    if (segmentsIntersect(a, b, c, d)) return true;
  }
  return false;
}

function bboxAreaSqM(bbox) {
  if (!bbox) return 0;
  const latMid = (bbox.south + bbox.north) / 2;
  const heightM = Math.abs(bbox.north - bbox.south) * 111_320;
  const widthM = Math.abs(bbox.east - bbox.west) * 111_320 * Math.cos((latMid * Math.PI) / 180);
  return heightM * widthM;
}

function routeSegmentCrossesBuildings(prevPoint, clickPoint, buildingList) {
  if (!prevPoint || !clickPoint) return false;
  if (!Array.isArray(buildingList) || buildingList.length === 0) return false;
  for (const b of buildingList) {
    if (!b?.ring || !b?.bbox) continue;
    const minLat = Math.min(prevPoint.lat, clickPoint.lat);
    const maxLat = Math.max(prevPoint.lat, clickPoint.lat);
    const minLng = Math.min(prevPoint.lng, clickPoint.lng);
    const maxLng = Math.max(prevPoint.lng, clickPoint.lng);
    if (
      maxLat < b.bbox.south ||
      minLat > b.bbox.north ||
      maxLng < b.bbox.west ||
      minLng > b.bbox.east
    ) {
      continue;
    }
    if (routeSegmentCrossesRing(prevPoint, clickPoint, b.ring)) return true;
  }
  return false;
}

function pathHasSegmentThroughBuildings(path, buildingList) {
  if (!Array.isArray(path) || path.length < 2) return false;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;
    const prev = { lat: Number(a[0]), lng: Number(a[1]) };
    const next = { lat: Number(b[0]), lng: Number(b[1]) };
    if (![prev.lat, prev.lng, next.lat, next.lng].every(Number.isFinite)) continue;
    if (routeSegmentCrossesBuildings(prev, next, buildingList)) return true;
  }
  return false;
}

function ringBbox(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  ring.forEach(([lat, lng]) => {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    minLat = Math.min(minLat, la);
    maxLat = Math.max(maxLat, la);
    minLng = Math.min(minLng, ln);
    maxLng = Math.max(maxLng, ln);
  });
  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return null;
  return { south: minLat, west: minLng, north: maxLat, east: maxLng };
}

async function fetchBuildingsFromOverpass(bbox, signal) {
  const query = `
[out:json][timeout:25];
(
  way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out body;
>;
out skel qt;
`.trim();

  const res = await fetch(OSM_OVERPASS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = await res.json();
  const elements = Array.isArray(data?.elements) ? data.elements : [];
  const nodes = new Map();
  const ways = [];
  elements.forEach((el) => {
    if (el?.type === 'node' && el?.id != null) {
      const lat = Number(el.lat);
      const lon = Number(el.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) nodes.set(el.id, [lat, lon]);
    } else if (el?.type === 'way' && Array.isArray(el?.nodes)) {
      ways.push(el);
    }
  });
  const polygons = [];
  ways.forEach((w) => {
    const pts = w.nodes.map((nid) => nodes.get(nid)).filter(Boolean);
    if (pts.length < 4) return;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const closed = first && last && first[0] === last[0] && first[1] === last[1];
    const ring = closed ? pts : [...pts, [...pts[0]]];
    if (ring.length < 4) return;
    const bbox = ringBbox(ring);
    if (!bbox) return;
    if (bboxAreaSqM(bbox) > MAX_BUILDING_FOOTPRINT_AREA_M2) return;
    polygons.push({ ring, bbox });
  });
  return polygons;
}

function scaleRingAroundCenter(ring, factor = 1.01) {
  if (!Array.isArray(ring) || ring.length < 4) return ring;
  const points = ring.slice(0, -1);
  if (!points.length) return ring;

  const sum = points.reduce(
    (acc, [lat, lng]) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return acc;
      acc.lat += lat;
      acc.lng += lng;
      acc.count += 1;
      return acc;
    },
    { lat: 0, lng: 0, count: 0 }
  );
  if (!sum.count) return ring;

  const centerLat = sum.lat / sum.count;
  const centerLng = sum.lng / sum.count;
  const scaled = points.map(([lat, lng]) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [lat, lng];
    return [
      centerLat + (lat - centerLat) * factor,
      centerLng + (lng - centerLng) * factor,
    ];
  });
  scaled.push([...scaled[0]]);
  return scaled;
}

function isPointInsideBoundary(boundary, point) {
  if (!Array.isArray(boundary) || boundary.length < 4 || !point) return false;
  const vertices = boundary.slice(0, -1);
  if (vertices.length < 3) return false;

  const x = point.lng;
  const y = point.lat;
  let inside = false;

  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const xi = vertices[i]?.[0];
    const yi = vertices[i]?.[1];
    const xj = vertices[j]?.[0];
    const yj = vertices[j]?.[1];
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;

    const intersects = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }

  return inside;
}

function areSamePolylineCoords(currentCoords, nextCoords) {
  if (!Array.isArray(currentCoords) || !Array.isArray(nextCoords)) return false;
  if (currentCoords.length !== nextCoords.length) return false;
  for (let i = 0; i < currentCoords.length; i += 1) {
    const a = currentCoords[i];
    const b = nextCoords[i];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return false;
    if (a[0] !== b[0] || a[1] !== b[1]) return false;
  }
  return true;
}

/**
 * Порог в «глобальных пикселях» Яндекс.Карт (MapEvent.globalPixels / projection.toGlobalPixels).
 * Одна система координат; масштаб зависит от zoom — порог слегка уменьшается на мелком масштабе.
 */
const ROUTE_SEGMENT_SHIFT_MAX_GLOBAL_BASE = 36;

function distancePointToSegment2D(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Клик в тех же глобальных пикселях, что и toGlobalPixels у вершин (MapEvent). */
function getClickGlobalPixels(e) {
  if (typeof e?.get !== 'function') return null;
  const gp = e.get('globalPixels');
  if (Array.isArray(gp) && gp.length >= 2 && gp.every(Number.isFinite)) {
    return { x: gp[0], y: gp[1] };
  }
  return null;
}

function geoToGlobalPixelsPoint(map, lat, lng) {
  if (!map || ![lat, lng].every(Number.isFinite)) return null;
  try {
    const projection = map.options.get('projection');
    if (!projection || typeof projection.toGlobalPixels !== 'function') return null;
    const zoom = map.getZoom();
    const gp = projection.toGlobalPixels([lat, lng], zoom);
    if (!Array.isArray(gp) || gp.length < 2 || !gp.every(Number.isFinite)) return null;
    return { x: gp[0], y: gp[1] };
  } catch {
    return null;
  }
}

/** Индекс отрезка path[i]→path[i+1] или -1 (path: [lat,lng]). */
function findNearestRouteSegmentGlobalPixels(map, path, clickGp, maxDistGp) {
  if (!map || !clickGp || !Array.isArray(path) || path.length < 2) return -1;
  let best = -1;
  let bestD = maxDistGp;
  for (let i = 0; i < path.length - 1; i += 1) {
    const [la0, ln0] = path[i];
    const [la1, ln1] = path[i + 1];
    if (![la0, ln0, la1, ln1].every(Number.isFinite)) continue;
    const p0 = geoToGlobalPixelsPoint(map, la0, ln0);
    const p1 = geoToGlobalPixelsPoint(map, la1, ln1);
    if (!p0 || !p1) continue;
    const d = distancePointToSegment2D(clickGp.x, clickGp.y, p0.x, p0.y, p1.x, p1.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Расстояние от точки до отрезка на земле (м) — для клика по GeoObject-полилинии (coords на линии). */
function distancePointToSegmentMeters(lat, lng, lat1, lng1, lat2, lng2) {
  const latRad = (lat * Math.PI) / 180;
  const cosLat = Math.cos(latRad) || 1e-6;
  const mPerLng = 111_320 * cosLat;
  const mPerLat = 111_320;
  const x = (lng - lng1) * mPerLng;
  const y = (lat - lat1) * mPerLat;
  const dx = (lng2 - lng1) * mPerLng;
  const dy = (lat2 - lat1) * mPerLat;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-4) return Math.hypot(x, y);
  let t = (x * dx + y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = t * dx;
  const py = t * dy;
  return Math.hypot(x - px, y - py);
}

function distanceBetweenPointsMeters(lat1, lng1, lat2, lng2) {
  const latMidRad = (((lat1 + lat2) / 2) * Math.PI) / 180;
  const cosLat = Math.cos(latMidRad) || 1e-6;
  const dx = (lng2 - lng1) * 111_320 * cosLat;
  const dy = (lat2 - lat1) * 111_320;
  return Math.hypot(dx, dy);
}

function findNearestRoutePointDistanceMeters(path, lat, lng) {
  if (!Array.isArray(path) || path.length === 0) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length; i += 1) {
    const p = path[i];
    if (!Array.isArray(p) || p.length < 2) continue;
    const la = Number(p[0]);
    const ln = Number(p[1]);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
    const d = distanceBetweenPointsMeters(lat, lng, la, ln);
    if (d < best) best = d;
  }
  return best;
}

function findNearestRouteSegmentMetersDetailed(path, lat, lng, maxM) {
  if (!Array.isArray(path) || path.length < 2) return { index: -1, distanceM: Number.POSITIVE_INFINITY };
  let best = -1;
  let bestD = maxM;
  for (let i = 0; i < path.length - 1; i += 1) {
    const [la0, ln0] = path[i];
    const [la1, ln1] = path[i + 1];
    if (![la0, ln0, la1, ln1].every(Number.isFinite)) continue;
    const d = distancePointToSegmentMeters(lat, lng, la0, ln0, la1, ln1);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, distanceM: best >= 0 ? bestD : Number.POSITIVE_INFINITY };
}

/** Клик по полилинии маршрута: coords почти на линии — узкий порог (м). */
const ROUTE_SEGMENT_SHIFT_POLYLINE_CLICK_MAX_M = 11;
const ROUTE_SEGMENT_SHIFT_SKIP_NEAR_POINT_M = 6;
const ROUTE_SEGMENT_SHIFT_POINT_PRIORITY_MARGIN_M = 1.2;

/** Четыре точки [lat,lng] → три отрезка вокруг центра карты (для шага тура). */
function buildOnboardingRouteShiftDemoPath(centerLat, centerLng) {
  const lat0 = Number(centerLat);
  const lng0 = Number(centerLng);
  if (![lat0, lng0].every(Number.isFinite)) return null;
  const dLat = 0.00036;
  const dLng = 0.00055;
  return [
    [lat0 - dLat * 0.25, lng0 - dLng * 1.1],
    [lat0 - dLat * 0.25, lng0 + dLng * 0.15],
    [lat0 + dLat * 1.0, lng0 + dLng * 0.15],
    [lat0 + dLat * 1.0, lng0 + dLng * 1.2],
  ];
}

/**
 * Прямоугольник зоны вокруг демо-маршрута (boundary API: [[lng, lat], ...] замкнутый).
 * Не рисуем поверх уже загруженных зон с бэка — только если контура ещё нет.
 */
function buildOnboardingRouteShiftDemoZoneBoundary(centerLat, centerLng) {
  const path = buildOnboardingRouteShiftDemoPath(centerLat, centerLng);
  if (!path) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const pair of path) {
    const la = Number(pair[0]);
    const ln = Number(pair[1]);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
    minLat = Math.min(minLat, la);
    maxLat = Math.max(maxLat, la);
    minLng = Math.min(minLng, ln);
    maxLng = Math.max(maxLng, ln);
  }
  if (!Number.isFinite(minLat)) return null;
  const spanLat = Math.max(maxLat - minLat, 1e-7);
  const spanLng = Math.max(maxLng - minLng, 1e-7);
  const padLat = Math.max(spanLat * 0.85, 0.00022);
  const padLng = Math.max(spanLng * 0.85, 0.00032);
  const lat1 = minLat - padLat;
  const lat2 = maxLat + padLat;
  const lng1 = minLng - padLng;
  const lng2 = maxLng + padLng;
  return [
    [lng1, lat1],
    [lng2, lat1],
    [lng2, lat2],
    [lng1, lat2],
    [lng1, lat1],
  ];
}

/** Объединить прямоугольники getBounds() [[lat,lng],[lat,lng]] для setBounds карты. */
function mergeYandexGeoBounds(boundsList) {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const b of boundsList) {
    if (!Array.isArray(b) || b.length < 2) continue;
    const [sw, ne] = b;
    if (!Array.isArray(sw) || !Array.isArray(ne)) continue;
    const lats = [sw[0], ne[0]];
    const lngs = [sw[1], ne[1]];
    for (const lat of lats) {
      if (Number.isFinite(lat)) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
    for (const lng of lngs) {
      if (Number.isFinite(lng)) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
    }
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

/** Какой из трёх отрезков (0..2) подсвечен как «смещение» в демо тура. */
const ONBOARDING_DEMO_SHIFT_SEGMENT_INDEX = 1;
const ONBOARDING_ROUTE_SHIFT_FIT_MS = 480;
const PREVIEW_ROUTE_FIT_MS = 320;

export function YandexMap({
  drones,
  mapCenter,
  mapZoom = 13,
  onMapClick,
  onDraftRectBoundaryChange,
  onRectDrawComplete,
  onZoneClick,
  onMapCenterChange,
  /** После программного setBounds / зума — синхронизировать zoom из карты в состояние (например шаг 6 тура). */
  onMapZoomChange,
  onDronePositionChange,
  placementMode = false,
  selectedDroneId = null,
  forceResize = false,
  editingPath = null,
  routeEditPath = null,
  onRoutePathChange,
  previewPath = null,
  routeEditMode = false,
  /** Список зон для одновременного отображения: [{ id, boundary, color, isActive }]. */
  zones = [],
  /** Полигон активной зоны (boundary из backend, [lng, lat]). */
  zoneBoundary = null,
  /** Цвет активной зоны (hex), например #22c55e. */
  zoneColor = '#22c55e',
  /** Увеличивайте после загрузки KML / смены зоны — карта подгонит вид под полигон. */
  zoneFitNonce = 0,
  /** Превью прямоугольника до сохранения зоны (тот же формат boundary). */
  draftRectBoundary = null,
  /** Режим рисования прямоугольника мышью (зажал-потянул-отпустил). */
  drawRectZoneMode = false,
  /** Индексы отрезков path[i]→path[i+1], помеченных как «смещение» (разворот между рядами). */
  routeShiftSegmentIndices = [],
  /** Переключить метку смещения для отрезка с индексом i (клик по отрезку или из списка). */
  onRouteShiftSegmentToggle,
  /** Текущий id шага тура (WorkspaceOnboarding): на шаге route-shift-segments (последний) кнопка «Смещения» и демо на карте. */
  workspaceOnboardingStepId = null,
  /** Запрос фокуса на точку (например, выбранный дрон): { center: [lat,lng], zoom?: number, nonce: number } */
  focusRequest = null,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const mapSizeRafRef = useRef(null);
  const lastMapSizeRef = useRef({ w: 0, h: 0 });
  const [buildings, setBuildings] = useState([]);
  const [buildingsStatus, setBuildingsStatus] = useState('idle');
  const buildingsAbortRef = useRef(null);
  const buildingsDebounceRef = useRef(null);
  const [buildingsNotice, setBuildingsNotice] = useState(null);
  const buildingsRef = useRef([]);
  const buildingsStatusRef = useRef('idle');
  const showBuildingsNoticeRef = useRef(null);
  const droneMarkersRef = useRef({});
  const dronePlaceAnimRafRef = useRef({});
  const dronePlaceAnimActiveRef = useRef(new Set());
  const droneRemoveAnimActiveRef = useRef(new Set());
  const dronePlaceTargetKeyRef = useRef(new Map());
  const droneMarkerPositionKeyRef = useRef(new Map());
  const droneDragActiveRef = useRef(new Set());
  const routeEditModeRef = useRef(false);
  const placementModeRef = useRef(false);
  const routePolylinesRef = useRef({});
  const editingPolylineRef = useRef(null);
  const previewPolylineRef = useRef(null);
  const routeEditPolylineRef = useRef(null);
  const routeEditPathRef = useRef(routeEditPath);
  const routeShiftHighlightPolylinesRef = useRef([]);
  const routeShiftDemoPolylinesRef = useRef([]);
  const routeShiftDemoZonePolygonRef = useRef(null);
  /** Фиксированный центр демо на шаге 6, чтобы после setBounds и смены mapCenter в App линия не «переезжала». */
  const routeShiftDemoAnchorRef = useRef(null);
  const routeShiftDemoDidFitRef = useRef(false);
  const workspaceOnboardingStepIdRef = useRef(workspaceOnboardingStepId);
  const lastPreviewFitKeyRef = useRef('');
  const routeShiftPolylineClickHandlerRef = useRef(null);
  const onRouteShiftSegmentToggleRef = useRef(onRouteShiftSegmentToggle);
  const routeEditGeometryChangeHandlerRef = useRef(null);
  const isSyncingRouteEditRef = useRef(false);
  const zonePolygonRef = useRef(null);
  const otherZonePolygonsRef = useRef([]);
  const hoveredPassiveZoneIdRef = useRef(null);
  const zoneBoundaryBaseRef = useRef(null);
  const zoneHoveredRef = useRef(false);
  const draftRectPolygonRef = useRef(null);
  const draftRectGeometryChangeHandlerRef = useRef(null);
  const isSyncingDraftRectRef = useRef(false);
  const rectDrawStateRef = useRef({ active: false, start: null, last: null });
  const lastZoneFitNonceRef = useRef(zoneFitNonce);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapType, setMapType] = useState(YANDEX_MAP_TYPE_SATELLITE);
  const [error, setError] = useState(null);
  const [routeShiftPanelOpen, setRouteShiftPanelOpen] = useState(false);
  const [routeShiftSelectionMode, setRouteShiftSelectionMode] = useState(false);
  const [routeShiftDemoAnchorVersion, setRouteShiftDemoAnchorVersion] = useState(0);
  const lastMapCenterRef = useRef(mapCenter);
  const lastMapZoomRef = useRef(mapZoom);

  routeEditModeRef.current = routeEditMode;
  placementModeRef.current = placementMode;
  routeEditPathRef.current = routeEditPath;
  onRouteShiftSegmentToggleRef.current = onRouteShiftSegmentToggle;
  workspaceOnboardingStepIdRef.current = workspaceOnboardingStepId;

  const API_KEY = '2b39244b-bae4-482a-b3a8-d4b21860b4e8';

  const zoneStrokeColor = /^#[0-9a-fA-F]{6}$/.test(zoneColor) ? zoneColor : '#22c55e';
  const zoneFillColor = `${zoneStrokeColor}2e`;
  const zoneHoverFillColor = `${zoneStrokeColor}47`;
  const normalizedZones = useMemo(
    () =>
      Array.isArray(zones)
        ? zones.filter((z) => Array.isArray(z?.boundary) && z.boundary.length >= 4)
        : [],
    [zones]
  );
  const activeZoneFromList = normalizedZones.find((z) => z?.isActive) ?? null;
  const activeBoundary = activeZoneFromList?.boundary ?? zoneBoundary;
  const activeStroke = /^#[0-9a-fA-F]{6}$/.test(activeZoneFromList?.color) ? activeZoneFromList.color : zoneStrokeColor;
  const activeFill = `${activeStroke}2e`;
  const activeHoverFill = `${activeStroke}47`;

  useEffect(() => {
    if (window.ymaps && window.yandexMapsLoaded) {
      setTimeout(initMap, 100);
      return;
    }
    if (window.yandexMapsLoading) {
      const interval = setInterval(() => {
        if (window.ymaps && window.yandexMapsLoaded) {
          clearInterval(interval);
          initMap();
        }
      }, 100);
      return;
    }

    window.yandexMapsLoading = true;
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${API_KEY}&lang=ru_RU`;
    script.async = true;

    script.onload = () => {
      if (!window.ymaps) {
        setError('API Яндекс.Карт не загрузилось');
        return;
      }
      window.ymaps.ready(() => {
        window.yandexMapsLoaded = true;
        window.yandexMapsLoading = false;
        initMap();
      });
    };

    script.onerror = () => {
      yandexMapsLoading = false;
      setError('Не удалось загрузить API Яндекс.Карт');
    };

    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (buildingsDebounceRef.current) {
      clearTimeout(buildingsDebounceRef.current);
      buildingsDebounceRef.current = null;
    }
    if (buildingsAbortRef.current) {
      try { buildingsAbortRef.current.abort(); } catch {}
      buildingsAbortRef.current = null;
    }

    const bboxRaw = computeBoundaryBbox(activeBoundary);
    if (!bboxRaw) {
      setBuildings([]);
      setBuildingsStatus('idle');
      return;
    }
    const bbox = inflateBbox(bboxRaw, 40);
    setBuildingsStatus('loading');

    buildingsDebounceRef.current = setTimeout(() => {
      const ac = new AbortController();
      buildingsAbortRef.current = ac;
      fetchBuildingsFromOverpass(bbox, ac.signal)
        .then((polys) => {
          setBuildings(Array.isArray(polys) ? polys : []);
          setBuildingsStatus('ready');
        })
        .catch((e) => {
          if (String(e?.name) === 'AbortError') return;
          console.warn('Overpass buildings fetch failed:', e?.message ?? e);
          setBuildingsStatus((prev) => (prev === 'ready' ? 'ready' : 'error'));
        })
        .finally(() => {
          buildingsAbortRef.current = null;
        });
    }, BUILDINGS_REFRESH_DEBOUNCE_MS);

    return () => {
      if (buildingsDebounceRef.current) {
        clearTimeout(buildingsDebounceRef.current);
        buildingsDebounceRef.current = null;
      }
      if (buildingsAbortRef.current) {
        try { buildingsAbortRef.current.abort(); } catch {}
        buildingsAbortRef.current = null;
      }
    };
  }, [activeBoundary]);

  useEffect(() => {
    buildingsRef.current = buildings;
    buildingsStatusRef.current = buildingsStatus;
  }, [buildings, buildingsStatus]);

  const cancelDroneMarkerAnim = (droneId) => {
    const id = String(droneId);
    const h = dronePlaceAnimRafRef.current[id];
    if (h != null) cancelAnimationFrame(h);
    delete dronePlaceAnimRafRef.current[id];
    dronePlaceAnimActiveRef.current.delete(id);
    droneRemoveAnimActiveRef.current.delete(id);
    dronePlaceTargetKeyRef.current.delete(id);
  };

  const finishRemoveDroneMarker = (map, droneId, placemark) => {
    const idStr = String(droneId);
    try {
      if (placemark && map?.geoObjects) map.geoObjects.remove(placemark);
    } catch {
      /* ignore */
    }
    if (droneMarkersRef.current[droneId] === placemark) {
      delete droneMarkersRef.current[droneId];
    }
    droneMarkerPositionKeyRef.current.delete(idStr);
    if (routePolylinesRef.current[droneId] && map?.geoObjects) {
      try {
        map.geoObjects.remove(routePolylinesRef.current[droneId]);
      } catch {
        /* ignore */
      }
      delete routePolylinesRef.current[droneId];
    }
  };

  const runDroneRemoveFlyOut = (map, droneId, placemark) => {
    const idStr = String(droneId);
    if (droneRemoveAnimActiveRef.current.has(idStr)) return;
    cancelDroneMarkerAnim(droneId);
    let from;
    try {
      from = placemark.geometry.getCoordinates();
    } catch {
      finishRemoveDroneMarker(map, droneId, placemark);
      return;
    }
    try {
      placemark.options.set('draggable', false);
    } catch {
      /* ignore */
    }
    const removeBearing = Math.random() * 2 * Math.PI;
    const to = offsetLatLngByMetersAndBearing(from[0], from[1], DRONE_PLACE_OFFSET_M, removeBearing);
    droneRemoveAnimActiveRef.current.add(idStr);
    const t0 = performance.now();
    const step = (now) => {
      if (droneMarkersRef.current[droneId] !== placemark) {
        cancelDroneMarkerAnim(droneId);
        return;
      }
      const u = Math.min(1, (now - t0) / DRONE_PLACE_DURATION_MS);
      const k = easeOutCubic(u);
      const lat = from[0] + (to[0] - from[0]) * k;
      const lng = from[1] + (to[1] - from[1]) * k;
      try {
        placemark.geometry.setCoordinates([lat, lng]);
      } catch {
        /* ignore */
      }
      if (u < 1) {
        dronePlaceAnimRafRef.current[idStr] = requestAnimationFrame(step);
      } else {
        delete dronePlaceAnimRafRef.current[idStr];
        droneRemoveAnimActiveRef.current.delete(idStr);
        finishRemoveDroneMarker(map, droneId, placemark);
      }
    };
    dronePlaceAnimRafRef.current[idStr] = requestAnimationFrame(step);
  };

  const initMap = () => {
    if (!mapContainerRef.current || !window.ymaps) return;
    if (mapInstanceRef.current) return;

    const map = new window.ymaps.Map(
      mapContainerRef.current,
      {
        center: mapCenter || [55.751244, 37.618423],
        zoom: mapZoom,
        type: YANDEX_MAP_TYPE_SATELLITE,
        controls: [],
      },
      {
        minZoom: MAP_MIN_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        avoidFractionalZoom: false,
      }
    );

    const center = mapCenter || [55.751244, 37.618423];
    applyYandexZoomRangeForType(map, YANDEX_MAP_TYPE_SATELLITE, center);

    mapInstanceRef.current = map;
    lastMapCenterRef.current = mapCenter;
    lastMapZoomRef.current = mapZoom;
    setMapLoaded(true);
    drones.forEach(drone => {
      if (!drone.position) return;
      createDroneMarker(map, drone);
    });
    drones.forEach(drone => {
      if (drone.path && drone.path.length > 1) {
        createDroneRoute(map, drone);
      }
    });
  };

  const createDroneMarker = (map, drone, { animatePlaceIn = false } = {}) => {
    if (!drone.position || !drone.isVisible) return;

    const target = [Number(drone.position.lat), Number(drone.position.lng)];
    const startCoords = animatePlaceIn
      ? offsetLatLngByMetersAndBearing(
          target[0],
          target[1],
          DRONE_PLACE_OFFSET_M,
          Math.random() * 2 * Math.PI
        )
      : target;

    const placemark = new window.ymaps.Placemark(
      startCoords,
      {
        balloonContent: `
          <div style="padding: 10px; font-family: Arial;">
            <strong>${drone.name}</strong><br/>
            Статус: ${drone.status}<br/>
            Батарея: ${drone.battery}%
          </div>
        `,
        hintContent: drone.name
      },
      {
        iconLayout: 'default#image',
        iconImageHref: '/ico.png',
        iconImageSize: [35, 35],
        iconImageOffset: [-17, -17],
        draggable: !isDroneFlyingLike(drone),
        balloonOffset: [0, -50],
        balloonAutoPan: false,
        hideIconOnBalloonOpen: false
      }
    );
    if (!isDroneFlyingLike(drone)) {
      placemark.events.add('dragstart', () => {
        droneDragActiveRef.current.add(String(drone.id));
      });
      placemark.events.add('dragend', (e) => {
        droneDragActiveRef.current.delete(String(drone.id));
        const coords = e.get('target').geometry.getCoordinates();
        if (onDronePositionChange) {
          onDronePositionChange(drone.id, { lat: coords[0], lng: coords[1] });
        }
      });
    }

    map.geoObjects.add(placemark);
    droneMarkersRef.current[drone.id] = placemark;

    const idStr = String(drone.id);
    if (animatePlaceIn) {
      cancelDroneMarkerAnim(drone.id);
      dronePlaceAnimActiveRef.current.add(idStr);
      dronePlaceTargetKeyRef.current.set(idStr, `${target[0]},${target[1]}`);
      const from = startCoords;
      const t0 = performance.now();
      const step = (now) => {
        if (droneMarkersRef.current[drone.id] !== placemark) {
          cancelDroneMarkerAnim(drone.id);
          return;
        }
        const u = Math.min(1, (now - t0) / DRONE_PLACE_DURATION_MS);
        const e = easeOutCubic(u);
        const lat = from[0] + (target[0] - from[0]) * e;
        const lng = from[1] + (target[1] - from[1]) * e;
        try {
          placemark.geometry.setCoordinates([lat, lng]);
        } catch {
          /* ignore */
        }
        if (u < 1) {
          dronePlaceAnimRafRef.current[idStr] = requestAnimationFrame(step);
        } else {
          delete dronePlaceAnimRafRef.current[idStr];
          dronePlaceAnimActiveRef.current.delete(idStr);
          dronePlaceTargetKeyRef.current.delete(idStr);
          droneMarkerPositionKeyRef.current.set(idStr, `${target[0]},${target[1]}`);
        }
      };
      dronePlaceAnimRafRef.current[idStr] = requestAnimationFrame(step);
    } else {
      droneMarkerPositionKeyRef.current.set(idStr, `${target[0]},${target[1]}`);
    }
  };

  const createDroneRoute = (map, drone) => {
    if (!drone.path || drone.path.length < 2) return;
    const nextCoords = drone.path.map((p) => [p[0], p[1]]);
    const strokeColor = drone.id === selectedDroneId ? '#FF0000' : '#3b82f6';
    const existingPolyline = routePolylinesRef.current[drone.id];
    if (existingPolyline) {
      const currentCoords = existingPolyline.geometry.getCoordinates();
      if (!areSamePolylineCoords(currentCoords, nextCoords)) {
        existingPolyline.geometry.setCoordinates(nextCoords);
      }
      existingPolyline.options.set({
        strokeColor,
        strokeWidth: 3,
        strokeOpacity: 0.7,
      });
      return;
    }

    const polyline = new window.ymaps.Polyline(
      nextCoords,
      {},
      {
        strokeColor,
        strokeWidth: 3,
        strokeOpacity: 0.7
      }
    );

    map.geoObjects.add(polyline);
    routePolylinesRef.current[drone.id] = polyline;
  };

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current) return;

    const map = mapInstanceRef.current;
    drones.forEach(drone => {
      const existingMarker = droneMarkersRef.current[drone.id];
      const idStr = String(drone.id);

      if (drone.isVisible && drone.position) {
        const pos = [Number(drone.position.lat), Number(drone.position.lng)];
        const posKey = `${pos[0]},${pos[1]}`;
        if (existingMarker) {
          if (routeEditMode || placementMode) {
            cancelDroneMarkerAnim(drone.id);
            existingMarker.geometry.setCoordinates(pos);
            droneMarkerPositionKeyRef.current.set(idStr, posKey);
            try {
              existingMarker.options.set(
                'draggable',
                !isDroneFlyingLike(drone) && !placementMode
              );
            } catch {
              /* ignore */
            }
          } else if (droneRemoveAnimActiveRef.current.has(idStr)) {
            cancelDroneMarkerAnim(drone.id);
            existingMarker.geometry.setCoordinates(pos);
            droneMarkerPositionKeyRef.current.set(idStr, posKey);
            try {
              existingMarker.options.set('draggable', !isDroneFlyingLike(drone));
            } catch {
              /* ignore */
            }
          } else if (dronePlaceAnimActiveRef.current.has(idStr)) {
            const tKey = dronePlaceTargetKeyRef.current.get(idStr);
            if (tKey !== posKey) {
              cancelDroneMarkerAnim(drone.id);
              existingMarker.geometry.setCoordinates(pos);
              droneMarkerPositionKeyRef.current.set(idStr, posKey);
            }
          } else if (isDroneFlyingLike(drone)) {
            existingMarker.geometry.setCoordinates(pos);
            droneMarkerPositionKeyRef.current.set(idStr, posKey);
          } else {
            const lastKey = droneMarkerPositionKeyRef.current.get(idStr);
            if (lastKey !== posKey) {
              existingMarker.geometry.setCoordinates(pos);
              droneMarkerPositionKeyRef.current.set(idStr, posKey);
            }
          }
        } else {
          createDroneMarker(map, drone, { animatePlaceIn: true });
        }
      } else if (existingMarker) {
        if (!droneRemoveAnimActiveRef.current.has(idStr)) {
          runDroneRemoveFlyOut(map, drone.id, existingMarker);
        }
      }
      if (drone.path && drone.path.length > 1) {
        createDroneRoute(map, drone);
      } else if (routePolylinesRef.current[drone.id]) {
        map.geoObjects.remove(routePolylinesRef.current[drone.id]);
        delete routePolylinesRef.current[drone.id];
      }
    });
    Object.keys(droneMarkersRef.current).forEach(droneId => {
      if (!drones.some(d => d.id.toString() === droneId)) {
        if (droneRemoveAnimActiveRef.current.has(String(droneId))) return;
        const marker = droneMarkersRef.current[droneId];
        runDroneRemoveFlyOut(map, droneId, marker);
      }
    });
    Object.keys(routePolylinesRef.current).forEach(droneId => {
      if (!drones.some(d => d.id.toString() === droneId)) {
        map.geoObjects.remove(routePolylinesRef.current[droneId]);
        delete routePolylinesRef.current[droneId];
      }
    });

  }, [drones, selectedDroneId, mapLoaded, routeEditMode, placementMode]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !window.ymaps) return;
    const map = mapInstanceRef.current;
    const path = editingPath && editingPath.length > 0 ? editingPath : null;

    if (editingPolylineRef.current) {
      map.geoObjects.remove(editingPolylineRef.current);
      editingPolylineRef.current = null;
    }
    if (path && path.length >= 2) {
      const polyline = new window.ymaps.Polyline(
        path.map(p => [p[0], p[1]]),
        {},
        { strokeColor: '#22c55e', strokeWidth: 4, strokeOpacity: 0.9 }
      );
      map.geoObjects.add(polyline);
      editingPolylineRef.current = polyline;
    }
    return () => {
      if (editingPolylineRef.current) {
        try { map.geoObjects.remove(editingPolylineRef.current); } catch { }
        editingPolylineRef.current = null;
      }
    };
  }, [mapLoaded, editingPath]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !window.ymaps) return;
    const map = mapInstanceRef.current;
    const path = previewPath && previewPath.length >= 2 ? previewPath : null;
    let syncViewportTimer = null;
    const pathKey = Array.isArray(path)
      ? path
          .map((p) => `${Number(p?.[0]).toFixed(6)},${Number(p?.[1]).toFixed(6)}`)
          .join('|')
      : '';

    if (previewPolylineRef.current) {
      map.geoObjects.remove(previewPolylineRef.current);
      previewPolylineRef.current = null;
    }
    if (path) {
      const polyline = new window.ymaps.Polyline(
        path.map(p => [p[0], p[1]]),
        {},
        { strokeColor: '#22c55e', strokeWidth: 4, strokeOpacity: 0.8 }
      );
      map.geoObjects.add(polyline);
      previewPolylineRef.current = polyline;

      // При выборе шаблона автоматически фокусируем карту на превью-маршруте.
      if (pathKey && lastPreviewFitKeyRef.current !== pathKey) {
        let bounds = null;
        try {
          bounds = polyline.geometry?.getBounds?.() ?? null;
        } catch {
          bounds = null;
        }
        if (bounds) {
          try {
            map.setBounds(bounds, {
              checkZoomRange: true,
              zoomMargin: [64, 64, 64, 64],
              duration: 220,
              timingFunction: 'ease-in-out',
            });
          } catch {
            /* ignore */
          }
          syncViewportTimer = window.setTimeout(() => {
            try {
              if (typeof onMapCenterChange === 'function') {
                const c = typeof map.getCenter === 'function' ? map.getCenter() : null;
                if (Array.isArray(c) && c.length >= 2) {
                  onMapCenterChange([Number(c[0]), Number(c[1])]);
                }
              }
              if (typeof onMapZoomChange === 'function') {
                const z = typeof map.getZoom === 'function' ? map.getZoom() : null;
                if (typeof z === 'number' && Number.isFinite(z)) onMapZoomChange(z);
              }
            } catch {
              /* ignore */
            }
          }, PREVIEW_ROUTE_FIT_MS);
        }
        lastPreviewFitKeyRef.current = pathKey;
      }
    } else {
      lastPreviewFitKeyRef.current = '';
    }
    return () => {
      if (syncViewportTimer != null) window.clearTimeout(syncViewportTimer);
      if (previewPolylineRef.current) {
        try { map.geoObjects.remove(previewPolylineRef.current); } catch { }
        previewPolylineRef.current = null;
      }
    };
  }, [mapLoaded, previewPath, onMapCenterChange, onMapZoomChange]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !window.ymaps) return;
    const map = mapInstanceRef.current;
    const path = Array.isArray(routeEditPath) ? routeEditPath : [];

    if (!routeEditMode || path.length === 0) {
      if (routeEditGeometryChangeHandlerRef.current && routeEditPolylineRef.current) {
        try {
          routeEditPolylineRef.current.geometry.events.remove('change', routeEditGeometryChangeHandlerRef.current);
        } catch { /* ignore */ }
        routeEditGeometryChangeHandlerRef.current = null;
      }
      if (routeEditPolylineRef.current) {
        if (routeShiftPolylineClickHandlerRef.current) {
          try {
            routeEditPolylineRef.current.events.remove('click', routeShiftPolylineClickHandlerRef.current);
          } catch { /* ignore */ }
          routeShiftPolylineClickHandlerRef.current = null;
        }
        try { map.geoObjects.remove(routeEditPolylineRef.current); } catch { /* ignore */ }
        routeEditPolylineRef.current = null;
      }
      return;
    }

    const nextCoords = path.map((p) => [p[0], p[1]]);

    if (!routeEditPolylineRef.current) {
      const polyline = new window.ymaps.Polyline(
        nextCoords,
        {},
        {
          strokeColor: '#f59e0b',
          strokeWidth: 4,
          strokeOpacity: 0.95,
          strokeStyle: 'shortdash',
          interactivityModel: 'default#geoObject',
          editorMenuManager: () => [],
        }
      );
      map.geoObjects.add(polyline);
      routeEditPolylineRef.current = polyline;

      const handleRouteGeometryChange = () => {
        if (isSyncingRouteEditRef.current) return;
        if (typeof onRoutePathChange !== 'function') return;
        const coords = polyline.geometry.getCoordinates();
        if (!Array.isArray(coords)) return;
        const nextPath = coords
          .filter((c) => Array.isArray(c) && c.length >= 2)
          .map((c) => [c[0], c[1]]);

        if (
          buildingsStatusRef.current === 'ready' &&
          pathHasSegmentThroughBuildings(nextPath, buildingsRef.current)
        ) {
          if (typeof showBuildingsNoticeRef.current === 'function') {
            showBuildingsNoticeRef.current('Нельзя прокладывать маршрут через здания (OSM).');
          }
          const prevPath = routeEditPathRef.current;
          if (Array.isArray(prevPath) && prevPath.length >= 2) {
            isSyncingRouteEditRef.current = true;
            try {
              polyline.geometry.setCoordinates(prevPath.map((p) => [p[0], p[1]]));
            } finally {
              isSyncingRouteEditRef.current = false;
            }
          }
          return;
        }

        onRoutePathChange(nextPath);
      };
      routeEditGeometryChangeHandlerRef.current = handleRouteGeometryChange;
      polyline.geometry.events.add('change', handleRouteGeometryChange);

      const handleRoutePolylineClick = (pe) => {
        if (!routeShiftSelectionMode) return;
        const fn = onRouteShiftSegmentToggleRef.current;
        if (typeof fn !== 'function') return;
        const coords = typeof pe.get === 'function' ? pe.get('coords') : null;
        if (!Array.isArray(coords) || coords.length < 2) return;
        const lat = coords[0];
        const lng = coords[1];
        const curPath = routeEditPathRef.current;
        if (!Array.isArray(curPath) || curPath.length < 2) return;
        const nearestPointM = findNearestRoutePointDistanceMeters(curPath, lat, lng);
        const segInfo = findNearestRouteSegmentMetersDetailed(
          curPath,
          lat,
          lng,
          ROUTE_SEGMENT_SHIFT_POLYLINE_CLICK_MAX_M
        );
        if (!segInfo || segInfo.index < 0) return;
        if (
          nearestPointM <= ROUTE_SEGMENT_SHIFT_SKIP_NEAR_POINT_M &&
          segInfo.distanceM > nearestPointM + ROUTE_SEGMENT_SHIFT_POINT_PRIORITY_MARGIN_M
        ) {
          return;
        }
        try {
          if (typeof pe.stopPropagation === 'function') pe.stopPropagation();
        } catch {
          /* ignore */
        }
        fn(segInfo.index);
      };
      polyline.events.add('click', handleRoutePolylineClick);
      routeShiftPolylineClickHandlerRef.current = handleRoutePolylineClick;
    } else {
      const polyline = routeEditPolylineRef.current;
      const current = polyline.geometry.getCoordinates();
      if (JSON.stringify(current) !== JSON.stringify(nextCoords)) {
        isSyncingRouteEditRef.current = true;
        try {
          polyline.geometry.setCoordinates(nextCoords);
        } finally {
          isSyncingRouteEditRef.current = false;
        }
      }
    }

    try {
      routeEditPolylineRef.current.editor.startEditing();
    } catch {
      /* ignore */
    }
  }, [mapLoaded, routeEditMode, routeEditPath, onRoutePathChange, routeShiftSelectionMode]);

  useEffect(() => {
    if (!routeEditMode) setRouteShiftPanelOpen(false);
  }, [routeEditMode]);

  useEffect(() => {
    if (!routeEditMode) setRouteShiftSelectionMode(false);
  }, [routeEditMode]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !window.ymaps) return;
    const map = mapInstanceRef.current;
    const clearHighlights = () => {
      routeShiftHighlightPolylinesRef.current.forEach((pl) => {
        try {
          map.geoObjects.remove(pl);
        } catch {
          /* ignore */
        }
      });
      routeShiftHighlightPolylinesRef.current = [];
    };
    clearHighlights();
    if (!routeEditMode) return;
    const path = Array.isArray(routeEditPath) ? routeEditPath : [];
    const marks = Array.isArray(routeShiftSegmentIndices) ? routeShiftSegmentIndices : [];
    if (path.length < 2 || marks.length === 0) return;
    marks.forEach((idx) => {
      if (!Number.isInteger(idx) || idx < 0 || idx >= path.length - 1) return;
      const a = path[idx];
      const b = path[idx + 1];
      if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return;
      const coords = [
        [a[0], a[1]],
        [b[0], b[1]],
      ];
      const pl = new window.ymaps.Polyline(
        coords,
        {},
        {
          strokeColor: '#c084fc',
          strokeWidth: 8,
          strokeOpacity: 0.95,
          interactivityModel: 'default#transparent',
        }
      );
      map.geoObjects.add(pl);
      routeShiftHighlightPolylinesRef.current.push(pl);
    });
    return clearHighlights;
  }, [mapLoaded, routeEditMode, routeEditPath, routeShiftSegmentIndices]);

  /** Зафиксировать центр демо один раз при входе на шаг 6 (без mapCenter в deps основного эффекта — нет мигания после setBounds). */
  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current) return;
    if (workspaceOnboardingStepId !== 'route-shift-segments') return;
    if (routeShiftDemoAnchorRef.current) return;
    const map = mapInstanceRef.current;
    let la = Array.isArray(mapCenter) && mapCenter.length >= 2 ? Number(mapCenter[0]) : NaN;
    let ln = Array.isArray(mapCenter) && mapCenter.length >= 2 ? Number(mapCenter[1]) : NaN;
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      try {
        const c = typeof map.getCenter === 'function' ? map.getCenter() : null;
        if (Array.isArray(c) && c.length >= 2) {
          la = Number(c[0]);
          ln = Number(c[1]);
        }
      } catch {
        /* ignore */
      }
    }
    if (Number.isFinite(la) && Number.isFinite(ln)) {
      routeShiftDemoAnchorRef.current = [la, ln];
      setRouteShiftDemoAnchorVersion((v) => v + 1);
    }
  }, [mapLoaded, workspaceOnboardingStepId, mapCenter]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !window.ymaps) return;
    const map = mapInstanceRef.current;
    const clearDemo = () => {
      routeShiftDemoPolylinesRef.current.forEach((pl) => {
        try {
          map.geoObjects.remove(pl);
        } catch {
          /* ignore */
        }
      });
      routeShiftDemoPolylinesRef.current = [];
      if (routeShiftDemoZonePolygonRef.current) {
        try {
          map.geoObjects.remove(routeShiftDemoZonePolygonRef.current);
        } catch {
          /* ignore */
        }
        routeShiftDemoZonePolygonRef.current = null;
      }
    };

    if (workspaceOnboardingStepId !== 'route-shift-segments') {
      routeShiftDemoAnchorRef.current = null;
      routeShiftDemoDidFitRef.current = false;
      clearDemo();
      return;
    }

    if (!routeShiftDemoAnchorRef.current) {
      clearDemo();
      return;
    }

    const [lat, lng] = routeShiftDemoAnchorRef.current;
    const demoPath = buildOnboardingRouteShiftDemoPath(lat, lng);
    if (!demoPath || demoPath.length < 4) {
      clearDemo();
      return;
    }

    const hasRealZone =
      normalizedZones.length > 0 ||
      (Array.isArray(zoneBoundary) && zoneBoundary.length >= 4);

    clearDemo();

    if (!hasRealZone) {
      const demoZoneBoundary = buildOnboardingRouteShiftDemoZoneBoundary(lat, lng);
      const zoneRing = boundaryToYandexRing(demoZoneBoundary);
      if (zoneRing) {
        const fillHex =
          typeof zoneStrokeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(zoneStrokeColor)
            ? `${zoneStrokeColor}5e`
            : 'rgba(52, 211, 153, 0.37)';
        const zonePoly = new window.ymaps.Polygon(
          [zoneRing],
          {},
          {
            fillColor: fillHex,
            strokeColor: zoneStrokeColor,
            strokeWidth: 3,
            strokeOpacity: 1,
            interactivityModel: 'default#transparent',
          }
        );
        map.geoObjects.add(zonePoly);
        routeShiftDemoZonePolygonRef.current = zonePoly;
      }
    }

    const main = new window.ymaps.Polyline(
      demoPath,
      {},
      {
        strokeColor: '#f59e0b',
        strokeWidth: 5,
        strokeOpacity: 0.92,
        strokeStyle: 'shortdash',
        interactivityModel: 'default#transparent',
      }
    );
    map.geoObjects.add(main);
    routeShiftDemoPolylinesRef.current.push(main);

    const i = ONBOARDING_DEMO_SHIFT_SEGMENT_INDEX;
    const segCoords = [
      [demoPath[i][0], demoPath[i][1]],
      [demoPath[i + 1][0], demoPath[i + 1][1]],
    ];
    const shiftPl = new window.ymaps.Polyline(
      segCoords,
      {},
      {
        strokeColor: '#c084fc',
        strokeWidth: 10,
        strokeOpacity: 0.95,
        interactivityModel: 'default#transparent',
      }
    );
    map.geoObjects.add(shiftPl);
    routeShiftDemoPolylinesRef.current.push(shiftPl);

    const boundsParts = [];
    try {
      const b0 = main.geometry?.getBounds?.();
      if (b0) boundsParts.push(b0);
    } catch {
      /* ignore */
    }
    try {
      const b1 = shiftPl.geometry?.getBounds?.();
      if (b1) boundsParts.push(b1);
    } catch {
      /* ignore */
    }
    try {
      const zp = routeShiftDemoZonePolygonRef.current;
      const b2 = zp?.geometry?.getBounds?.();
      if (b2) boundsParts.push(b2);
    } catch {
      /* ignore */
    }

    const merged = mergeYandexGeoBounds(boundsParts);
    let syncViewportTimer = null;
    if (merged && !routeShiftDemoDidFitRef.current) {
      try {
        map.setBounds(merged, {
          checkZoomRange: true,
          zoomMargin: 72,
          duration: 280,
          timingFunction: 'ease-in-out',
        });
      } catch {
        /* ignore */
      }
      syncViewportTimer = window.setTimeout(() => {
        try {
          if (workspaceOnboardingStepIdRef.current !== 'route-shift-segments') return;
          const c = typeof map.getCenter === 'function' ? map.getCenter() : null;
          const z = typeof map.getZoom === 'function' ? map.getZoom() : null;
          if (Array.isArray(c) && c.length >= 2 && typeof onMapCenterChange === 'function') {
            onMapCenterChange([Number(c[0]), Number(c[1])]);
          }
          if (typeof z === 'number' && Number.isFinite(z) && typeof onMapZoomChange === 'function') {
            onMapZoomChange(z);
          }
          routeShiftDemoDidFitRef.current = true;
        } catch {
          /* ignore */
        }
      }, ONBOARDING_ROUTE_SHIFT_FIT_MS - 40);
    }

    return () => {
      if (syncViewportTimer != null) window.clearTimeout(syncViewportTimer);
      clearDemo();
    };
  }, [
    mapLoaded,
    workspaceOnboardingStepId,
    routeShiftDemoAnchorVersion,
    normalizedZones.length,
    zoneBoundary,
    zoneStrokeColor,
    onMapCenterChange,
    onMapZoomChange,
  ]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !window.ymaps) return;
    const map = mapInstanceRef.current;

    if (otherZonePolygonsRef.current.length) {
      otherZonePolygonsRef.current.forEach((item) => {
        try {
          map.geoObjects.remove(item.polygon);
        } catch {
          /* ignore */
        }
      });
      otherZonePolygonsRef.current = [];
    }

    if (zonePolygonRef.current) {
      try {
        map.geoObjects.remove(zonePolygonRef.current);
      } catch {
        /* ignore */
      }
      zonePolygonRef.current = null;
    }

    const zonesToRender = normalizedZones.length
      ? normalizedZones
      : (zoneBoundary ? [{ id: 'legacy-active', boundary: zoneBoundary, color: zoneColor, isActive: true }] : []);

    const activeEntry = zonesToRender.find((z) => z?.isActive) ?? zonesToRender[0] ?? null;
    const passiveEntries = activeEntry
      ? zonesToRender.filter((z) => String(z.id) !== String(activeEntry.id))
      : [];

    passiveEntries.forEach((entry) => {
      const passiveRing = boundaryToYandexRing(entry.boundary);
      if (!passiveRing) return;
      const stroke = /^#[0-9a-fA-F]{6}$/.test(entry?.color) ? entry.color : '#22c55e';
      const poly = new window.ymaps.Polygon(
        [passiveRing],
        {},
        {
          fillColor: `${stroke}1f`,
          strokeColor: stroke,
          strokeWidth: 2,
          strokeOpacity: 0.75,
          interactivityModel: 'default#transparent',
        }
      );
      map.geoObjects.add(poly);
      otherZonePolygonsRef.current.push({
        id: String(entry.id),
        polygon: poly,
        color: stroke,
      });
    });

    const ring = boundaryToYandexRing(activeEntry?.boundary);
    if (!ring) {
      zoneBoundaryBaseRef.current = null;
      zoneHoveredRef.current = false;
      return;
    }
    zoneBoundaryBaseRef.current = ring;
    zoneHoveredRef.current = false;

    const polygon = new window.ymaps.Polygon(
      [ring],
      {},
      {
        fillColor: activeFill,
        strokeColor: activeStroke,
        strokeWidth: 2,
        strokeOpacity: 0.95,
        // Иначе полигон «съедает» клики: нельзя разместить дрон и поставить точки маршрута.
        interactivityModel: 'default#transparent',
      }
    );
    map.geoObjects.add(polygon);
    zonePolygonRef.current = polygon;

    const shouldFit =
      ring &&
      lastZoneFitNonceRef.current !== zoneFitNonce;
    if (shouldFit) {
      lastZoneFitNonceRef.current = zoneFitNonce;
      try {
        const bounds = polygon.geometry.getBounds();
        if (bounds) {
          map.setBounds(bounds, {
            checkZoomRange: true,
            zoomMargin: 24,
            duration: ZONE_FIT_ANIMATION_MS,
            timingFunction: 'ease-in-out',
          });
        }
      } catch {
        /* ignore */
      }
    }

    return () => {
      zoneBoundaryBaseRef.current = null;
      zoneHoveredRef.current = false;
      hoveredPassiveZoneIdRef.current = null;
      if (otherZonePolygonsRef.current.length) {
        otherZonePolygonsRef.current.forEach((item) => {
          try {
            map.geoObjects.remove(item.polygon);
          } catch {
            /* ignore */
          }
        });
        otherZonePolygonsRef.current = [];
      }
      if (zonePolygonRef.current) {
        try {
          map.geoObjects.remove(zonePolygonRef.current);
        } catch {
          /* ignore */
        }
        zonePolygonRef.current = null;
      }
    };
  }, [mapLoaded, normalizedZones, zoneBoundary, zoneColor, zoneFitNonce, activeFill, activeStroke]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !activeBoundary || drawRectZoneMode) return;
    const map = mapInstanceRef.current;

    const setHoverState = (hovered) => {
      if (!zonePolygonRef.current || !zoneBoundaryBaseRef.current) return;
      if (zoneHoveredRef.current === hovered) return;
      zoneHoveredRef.current = hovered;
      const baseRing = zoneBoundaryBaseRef.current;
      try {
        zonePolygonRef.current.geometry.setCoordinates([
          hovered ? scaleRingAroundCenter(baseRing, 1.0125) : baseRing,
        ]);
        zonePolygonRef.current.options.set({
          fillColor: hovered ? activeHoverFill : activeFill,
          strokeColor: activeStroke,
          strokeWidth: hovered ? 3 : 2,
        });
      } catch {
        /* ignore */
      }
    };

    const resetPassiveHover = () => {
      if (!otherZonePolygonsRef.current.length) return;
      otherZonePolygonsRef.current.forEach((item) => {
        try {
          item.polygon.options.set({
            fillColor: `${item.color}1f`,
            strokeColor: item.color,
            strokeWidth: 2,
            strokeOpacity: 0.75,
          });
        } catch {
          /* ignore */
        }
      });
      hoveredPassiveZoneIdRef.current = null;
    };

    const setPassiveHover = (zoneId) => {
      const normalizedId = String(zoneId);
      if (hoveredPassiveZoneIdRef.current === normalizedId) return;
      resetPassiveHover();
      const target = otherZonePolygonsRef.current.find((item) => item.id === normalizedId);
      if (!target) return;
      try {
        target.polygon.options.set({
          fillColor: `${target.color}47`,
          strokeColor: target.color,
          strokeWidth: 3,
          strokeOpacity: 0.95,
        });
        hoveredPassiveZoneIdRef.current = normalizedId;
      } catch {
        /* ignore */
      }
    };

    const handleMouseMove = (e) => {
      const coords = e.get('coords');
      if (!Array.isArray(coords) || coords.length < 2) return;
      const point = { lat: coords[0], lng: coords[1] };
      const zonesForHit = normalizedZones.length
        ? normalizedZones
        : (activeBoundary ? [{ id: null, boundary: activeBoundary, isActive: true }] : []);
      const hoveredZone = [...zonesForHit]
        .reverse()
        .find((z) => isPointInsideBoundary(z?.boundary, point));

      if (!hoveredZone) {
        setHoverState(false);
        resetPassiveHover();
        return;
      }
      if (hoveredZone.isActive) {
        setHoverState(true);
        resetPassiveHover();
        return;
      }

      setHoverState(false);
      setPassiveHover(hoveredZone.id);
    };
    const handleMouseOut = () => {
      setHoverState(false);
      resetPassiveHover();
    };

    map.events.add('mousemove', handleMouseMove);
    map.events.add('mouseout', handleMouseOut);

    return () => {
      map.events.remove('mousemove', handleMouseMove);
      map.events.remove('mouseout', handleMouseOut);
      setHoverState(false);
    };
  }, [mapLoaded, activeBoundary, normalizedZones, drawRectZoneMode, activeFill, activeHoverFill, activeStroke]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !window.ymaps) return;
    const map = mapInstanceRef.current;

    const ring = boundaryToYandexRing(draftRectBoundary);
    if (!ring) {
      if (draftRectPolygonRef.current) {
        if (draftRectGeometryChangeHandlerRef.current) {
          try {
            draftRectPolygonRef.current.geometry.events.remove('change', draftRectGeometryChangeHandlerRef.current);
          } catch {
            /* ignore */
          }
          draftRectGeometryChangeHandlerRef.current = null;
        }
        try {
          map.geoObjects.remove(draftRectPolygonRef.current);
        } catch {
          /* ignore */
        }
        draftRectPolygonRef.current = null;
      }
      return;
    }

    if (!draftRectPolygonRef.current) {
      const polygon = new window.ymaps.Polygon(
        [ring],
        {},
        {
          fillColor: 'rgba(251, 191, 36, 0.22)',
          strokeColor: '#f59e0b',
          strokeWidth: 3,
          strokeOpacity: 0.95,
          strokeStyle: 'shortdash',
          interactivityModel: 'default#geoObject',
          hasBalloon: false,
          hasHint: false,
          openEmptyBalloon: false,
          openBalloonOnClick: false,
          editorMenuManager: () => [],
        }
      );
      map.geoObjects.add(polygon);
      draftRectPolygonRef.current = polygon;

      const handleDraftRectGeometryChange = () => {
        if (isSyncingDraftRectRef.current) return;
        if (typeof onDraftRectBoundaryChange !== 'function') return;
        const coords = polygon.geometry.getCoordinates();
        const nextRing = Array.isArray(coords) ? coords[0] : null;
        const nextBoundary = yandexRingToBoundary(nextRing);
        if (nextBoundary) onDraftRectBoundaryChange(nextBoundary);
      };
      draftRectGeometryChangeHandlerRef.current = handleDraftRectGeometryChange;
      polygon.geometry.events.add('change', handleDraftRectGeometryChange);
    } else {
      const polygon = draftRectPolygonRef.current;
      const currentCoords = polygon.geometry.getCoordinates();
      const currentRing = Array.isArray(currentCoords) ? currentCoords[0] : null;
      const currentBoundary = yandexRingToBoundary(currentRing);
      const normalizedTargetBoundary = yandexRingToBoundary(ring);
      if (JSON.stringify(currentBoundary) !== JSON.stringify(normalizedTargetBoundary)) {
        isSyncingDraftRectRef.current = true;
        try {
          polygon.geometry.setCoordinates([ring]);
        } finally {
          isSyncingDraftRectRef.current = false;
        }
      }
    }

    try {
      draftRectPolygonRef.current.editor.startEditing();
    } catch {
      /* ignore */
    }
  }, [mapLoaded, draftRectBoundary, onDraftRectBoundaryChange]);

  const createDroneIcon = (drone, isActive = false) => {
    const color = getDroneColor(drone.id);
    const isFlying = drone.isFlying;

    return L.divIcon({
      html: `
      <div style="
        width: ${isFlying ? '40px' : '32px'};
        height: ${isFlying ? '40px' : '32px'};
        background: ${color};
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        transform: rotate(${drone.heading || 0}deg);
        ${isFlying ? 'animation: pulse 2s infinite;' : ''}
        ${isActive ? 'box-shadow: 0 0 0 3px #FFD700;' : ''}
      ">
        <div style="
          width: ${isFlying ? '16px' : '12px'};
          height: ${isFlying ? '16px' : '12px'};
          background: white;
          border-radius: 50%;
          transform: rotate(-${drone.heading || 0}deg);
        "></div>
        ${isFlying ? `
          <div style="
            position: absolute;
            top: -10px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(255,255,255,0.9);
            color: ${color};
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: bold;
            white-space: nowrap;
          ">
            ${Math.round((drone.speed || 0) * 3.6)} км/ч
          </div>
        ` : ''}
      </div>
      ${isFlying ? `
        <div style="
          position: absolute;
          bottom: -25px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0,0,0,0.7);
          color: white;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          white-space: nowrap;
        ">
          ${drone.altitude || 0} м
        </div>
      ` : ''}
    `,
      iconSize: isFlying ? [40, 60] : [32, 32],
      iconAnchor: isFlying ? [20, 40] : [16, 16],
      className: 'drone-marker'
    });
  };

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !mapCenter) return;
    const shouldUpdateCenter =
      lastMapCenterRef.current[0] !== mapCenter[0] ||
      lastMapCenterRef.current[1] !== mapCenter[1];

    const shouldUpdateZoom = lastMapZoomRef.current !== mapZoom;

    if (shouldUpdateCenter || shouldUpdateZoom) {
      if (shouldUpdateCenter) {
        mapInstanceRef.current.setCenter(mapCenter);
        lastMapCenterRef.current = mapCenter;
      }
      if (shouldUpdateZoom) {
        mapInstanceRef.current.setZoom(mapZoom);
        lastMapZoomRef.current = mapZoom;
      }
    }
  }, [mapCenter, mapZoom, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    try {
      map.setType(mapType);
    } catch {
      /* ignore */
    }
    let center = mapCenter;
    try {
      const c = typeof map.getCenter === 'function' ? map.getCenter() : null;
      if (Array.isArray(c) && c.length >= 2) center = c;
    } catch {
      /* ignore */
    }
    applyYandexZoomRangeForType(map, mapType, center);
  }, [mapType, mapLoaded, mapCenter]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current) return;
    if (!focusRequest || typeof focusRequest !== 'object') return;
    const nonce = focusRequest.nonce;
    const center = focusRequest.center;
    const zoom = focusRequest.zoom;
    if (nonce == null) return;
    if (!Array.isArray(center) || center.length < 2) return;
    const lat = Number(center[0]);
    const lng = Number(center[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const nextZoom = typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : null;

    const map = mapInstanceRef.current;
    let syncTimer = null;
    try {
      // Один плавный переход (центр + зум) — без резких “скачков”.
      const z =
        nextZoom != null
          ? nextZoom
          : (typeof map.getZoom === 'function' ? map.getZoom() : null);
      map.setCenter([lat, lng], z, {
        duration: ZONE_FIT_ANIMATION_MS,
        timingFunction: 'ease-in-out',
      });
    } catch {
      // Fallback: если анимированный setCenter недоступен — хотя бы плавный panTo.
      try {
        map.panTo([lat, lng], {
          delay: 0,
          duration: ZONE_FIT_ANIMATION_MS,
          flying: true,
          timingFunction: 'ease-in-out',
        });
        if (nextZoom != null) {
          // Зум отдельно, но только в fallback-ветке.
          try {
            map.setZoom(nextZoom, { duration: ZONE_FIT_ANIMATION_MS });
          } catch {
            map.setZoom(nextZoom);
          }
        }
      } catch {
        try {
          map.setCenter([lat, lng]);
          if (nextZoom != null) map.setZoom(nextZoom);
        } catch {
          /* ignore */
        }
      }
    }

    syncTimer = window.setTimeout(() => {
      try {
        const c = typeof map.getCenter === 'function' ? map.getCenter() : null;
        const z = typeof map.getZoom === 'function' ? map.getZoom() : null;
        if (Array.isArray(c) && c.length >= 2 && typeof onMapCenterChange === 'function') {
          onMapCenterChange([Number(c[0]), Number(c[1])]);
        }
        if (typeof z === 'number' && Number.isFinite(z) && typeof onMapZoomChange === 'function') {
          onMapZoomChange(z);
        }
      } catch {
        /* ignore */
      }
    }, ZONE_FIT_ANIMATION_MS);

    return () => window.clearTimeout(syncTimer);
  }, [mapLoaded, focusRequest, onMapCenterChange, onMapZoomChange]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current) return;
    if (drawRectZoneMode) return;

    const map = mapInstanceRef.current;
    const handleClick = (e) => {
      const coords = e.get('coords');
      if (!Array.isArray(coords) || coords.length < 2) return;
      const clickPoint = { lat: coords[0], lng: coords[1] };

      const showBuildingsNotice = (text) => {
        setBuildingsNotice(text);
        window.setTimeout(() => {
          try {
            setBuildingsNotice((prev) => (prev === text ? null : prev));
          } catch {
            /* ignore */
          }
        }, 1400);
      };
      showBuildingsNoticeRef.current = showBuildingsNotice;

      if (routeEditMode) {
        const path = Array.isArray(routeEditPathRef.current) ? routeEditPathRef.current : [];
        if (routeShiftSelectionMode && path.length >= 2 && typeof onRouteShiftSegmentToggle === 'function') {
          const nearestPointM = findNearestRoutePointDistanceMeters(path, clickPoint.lat, clickPoint.lng);
          const segInfo = findNearestRouteSegmentMetersDetailed(
            path,
            clickPoint.lat,
            clickPoint.lng,
            ROUTE_SEGMENT_SHIFT_POLYLINE_CLICK_MAX_M
          );
          if (
            segInfo &&
            segInfo.index >= 0 &&
            !(
              nearestPointM <= ROUTE_SEGMENT_SHIFT_SKIP_NEAR_POINT_M &&
              segInfo.distanceM > nearestPointM + ROUTE_SEGMENT_SHIFT_POINT_PRIORITY_MARGIN_M
            )
          ) {
            onRouteShiftSegmentToggle(segInfo.index);
            return;
          }
          return;
        }
        const last = path.length > 0 ? path[path.length - 1] : null;
        const prev =
          Array.isArray(last) && last.length >= 2
            ? { lat: Number(last[0]), lng: Number(last[1]) }
            : null;
        const buildingList =
          buildingsStatusRef.current === 'ready' ? buildingsRef.current : [];
        if (
          prev &&
          buildingList.length > 0 &&
          routeSegmentCrossesBuildings(prev, clickPoint, buildingList)
        ) {
          showBuildingsNotice('Нельзя прокладывать маршрут через здания (OSM).');
          return;
        }
        if (typeof onMapClick === 'function') {
          onMapClick(clickPoint);
        }
        return;
      }
      if (placementMode) {
        if (typeof onMapClick === 'function') {
          onMapClick(clickPoint);
        }
        return;
      }
      const zonesForHit = normalizedZones.length
        ? normalizedZones
        : (activeBoundary ? [{ id: null, boundary: activeBoundary }] : []);
      const clickedZone = [...zonesForHit]
        .reverse()
        .find((z) => isPointInsideBoundary(z?.boundary, clickPoint));
      if (
        typeof onZoneClick === 'function' &&
        clickedZone
      ) {
        const ring = boundaryToYandexRing(clickedZone.boundary);
        if (ring && ring.length > 0) {
          let minLat = Number.POSITIVE_INFINITY;
          let maxLat = Number.NEGATIVE_INFINITY;
          let minLng = Number.POSITIVE_INFINITY;
          let maxLng = Number.NEGATIVE_INFINITY;
          ring.forEach(([lat, lng]) => {
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
          });
          if (
            Number.isFinite(minLat) &&
            Number.isFinite(maxLat) &&
            Number.isFinite(minLng) &&
            Number.isFinite(maxLng)
          ) {
            const zoneCenter = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
            try {
              map.panTo(zoneCenter, {
                delay: 0,
                duration: 350,
                flying: true,
                timingFunction: 'ease-in-out',
              });
            } catch {
              try {
                map.setCenter(zoneCenter);
              } catch {
                /* ignore */
              }
            }
          }
        }
        onZoneClick(clickedZone.boundary, clickedZone);
        return;
      }
      if (typeof onMapClick === 'function') {
        onMapClick(clickPoint);
      }
    };

    map.events.add('click', handleClick);

    return () => map.events.remove('click', handleClick);
  }, [
    onMapClick,
    onZoneClick,
    activeBoundary,
    normalizedZones,
    mapLoaded,
    drawRectZoneMode,
    routeEditMode,
    routeShiftSelectionMode,
    placementMode,
    onRouteShiftSegmentToggle,
    buildings,
    buildingsStatus,
  ]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current) return;
    if (!drawRectZoneMode) return;
    const map = mapInstanceRef.current;
    const MIN_RECT_SPAN = 1e-7;

    const finishRectDraw = (endPoint) => {
      if (!rectDrawStateRef.current.active || !rectDrawStateRef.current.start) return;

      const start = rectDrawStateRef.current.start;
      const end = endPoint || rectDrawStateRef.current.last;
      rectDrawStateRef.current = { active: false, start: null, last: null };

      try {
        map.behaviors.enable('drag');
      } catch {
        /* ignore */
      }

      if (!end) {
        if (typeof onDraftRectBoundaryChange === 'function') onDraftRectBoundaryChange(null);
        return;
      }

      const latSpan = Math.abs(end.lat - start.lat);
      const lngSpan = Math.abs(end.lng - start.lng);
      if (latSpan < MIN_RECT_SPAN || lngSpan < MIN_RECT_SPAN) {
        if (typeof onDraftRectBoundaryChange === 'function') onDraftRectBoundaryChange(null);
        return;
      }

      const boundary = rectCornersToBoundary(start, end);
      if (boundary && typeof onDraftRectBoundaryChange === 'function') {
        onDraftRectBoundaryChange(boundary);
      }
      if (typeof onRectDrawComplete === 'function') {
        onRectDrawComplete();
      }
    };

    const handleMouseDown = (e) => {
      const coords = e.get('coords');
      if (!Array.isArray(coords) || coords.length < 2) return;
      rectDrawStateRef.current = {
        active: true,
        start: { lat: coords[0], lng: coords[1] },
        last: { lat: coords[0], lng: coords[1] },
      };
      if (typeof onDraftRectBoundaryChange === 'function') {
        onDraftRectBoundaryChange(null);
      }
      try {
        map.behaviors.disable('drag');
      } catch {
        /* ignore */
      }
    };

    const handleMouseMove = (e) => {
      if (!rectDrawStateRef.current.active || !rectDrawStateRef.current.start) return;
      const coords = e.get('coords');
      if (!Array.isArray(coords) || coords.length < 2) return;
      const current = { lat: coords[0], lng: coords[1] };
      rectDrawStateRef.current.last = current;
      const boundary = rectCornersToBoundary(rectDrawStateRef.current.start, current);
      if (boundary && typeof onDraftRectBoundaryChange === 'function') {
        onDraftRectBoundaryChange(boundary);
      }
    };

    const handleMouseUp = (e) => {
      const coords = e.get('coords');
      const end =
        Array.isArray(coords) && coords.length >= 2 ? { lat: coords[0], lng: coords[1] } : null;
      finishRectDraw(end);
    };

    const handleWindowMouseUp = () => {
      finishRectDraw(null);
    };

    map.events.add('mousedown', handleMouseDown);
    map.events.add('mousemove', handleMouseMove);
    map.events.add('mouseup', handleMouseUp);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      map.events.remove('mousedown', handleMouseDown);
      map.events.remove('mousemove', handleMouseMove);
      map.events.remove('mouseup', handleMouseUp);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      rectDrawStateRef.current = { active: false, start: null, last: null };
      try {
        map.behaviors.enable('drag');
      } catch {
        /* ignore */
      }
    };
  }, [mapLoaded, drawRectZoneMode, onDraftRectBoundaryChange, onRectDrawComplete]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || typeof onMapCenterChange !== 'function') return;

    const map = mapInstanceRef.current;
    const handleMoveEnd = () => {
      const center = map.getCenter();
      if (center && Array.isArray(center) && center.length >= 2) {
        onMapCenterChange([center[0], center[1]]);
      }
    };

    map.events.add('actionend', handleMoveEnd);
    return () => map.events.remove('actionend', handleMoveEnd);
  }, [onMapCenterChange, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !mapContainerRef.current) return;

    const scheduleMapResize = (nextW = null, nextH = null) => {
      // Скролл/анимации могут вызывать частые resize/RO callbacks.
      // Сжимаем вызовы в 1 апдейт на кадр и только при реальном изменении размера.
      if (!mapInstanceRef.current || !mapContainerRef.current) return;

      const container = mapContainerRef.current;
      const w = Number.isFinite(nextW) ? nextW : container.offsetWidth;
      const h = Number.isFinite(nextH) ? nextH : container.offsetHeight;
      if (!(w > 0 && h > 0)) return;

      const prev = lastMapSizeRef.current;
      if (prev.w === w && prev.h === h) return;
      lastMapSizeRef.current = { w, h };

      if (mapSizeRafRef.current != null) return;
      mapSizeRafRef.current = requestAnimationFrame(() => {
        mapSizeRafRef.current = null;
        const map = mapInstanceRef.current;
        const c = mapContainerRef.current;
        if (!map || !c) return;

        const width = c.offsetWidth;
        const height = c.offsetHeight;
        if (!(width > 0 && height > 0)) return;

        try {
          map.container.fitToViewport();
        } catch (error) {
          try {
            map.container.setSize([width, height]);
          } catch (e) {
            console.warn('Не удалось обновить размер карты:', e);
          }
        }
      });
    };

    const handleWindowResize = () => scheduleMapResize();
    window.addEventListener('resize', handleWindowResize, { passive: true });
    let resizeObserver = null;
    if (mapContainerRef.current && window.ResizeObserver) {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = Array.isArray(entries) ? entries[0] : null;
        const cr = entry?.contentRect;
        const w = cr ? Math.round(cr.width) : null;
        const h = cr ? Math.round(cr.height) : null;
        scheduleMapResize(w, h);
      });
      resizeObserver.observe(mapContainerRef.current);
    } else {
      const intervalId = setInterval(() => {
        if (mapContainerRef.current && mapInstanceRef.current) {
          scheduleMapResize();
        }
      }, 500);
      
      return () => {
        clearInterval(intervalId);
        window.removeEventListener('resize', handleWindowResize);
        if (resizeObserver) {
          resizeObserver.disconnect();
        }
        if (mapSizeRafRef.current != null) {
          cancelAnimationFrame(mapSizeRafRef.current);
          mapSizeRafRef.current = null;
        }
      };
    }

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (mapSizeRafRef.current != null) {
        cancelAnimationFrame(mapSizeRafRef.current);
        mapSizeRafRef.current = null;
      }
    };
  }, [mapLoaded]);

  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !mapContainerRef.current) return;
    const timeoutId = setTimeout(() => {
      if (mapInstanceRef.current && mapContainerRef.current) {
        try {
          const map = mapInstanceRef.current;
          const container = mapContainerRef.current;
          const width = container.offsetWidth;
          const height = container.offsetHeight;
          
          if (width > 0 && height > 0) {
            map.container.fitToViewport();
          }
        } catch (error) {
          try {
            const map = mapInstanceRef.current;
            const container = mapContainerRef.current;
            if (map && container) {
              const width = container.offsetWidth;
              const height = container.offsetHeight;
              if (width > 0 && height > 0) {
                map.container.setSize([width, height]);
              }
            }
          } catch (e) {
            console.warn('Не удалось обновить размер карты:', e);
          }
        }
      }
    }, 350);
    return () => clearTimeout(timeoutId);
  }, [forceResize, mapLoaded]);


  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current) return;

    const removeYandexElements = () => {
      const selectorsToRemove = [
        '.ymaps-2-1-79-gotoymaps__container',
        '.ymaps-2-1-79-gotoymaps__text-container',
        '.ymaps-2-1-79-gototech',
        '.ymaps-2-1-79-copyright__content',
        '.ymaps-2-1-79-copyright__agreement',
        '.ymaps-2-1-79-copyright__logo-cell'
      ];

      selectorsToRemove.forEach(selector => {
        document.querySelectorAll(selector).forEach(element => {
          element.remove();
        });
      });
    };
    const timeoutId = setTimeout(removeYandexElements, 500); 

    return () => clearTimeout(timeoutId);
  }, [mapLoaded]);

  useEffect(() => {
    return () => {
      Object.keys(dronePlaceAnimRafRef.current).forEach(id => {
        const h = dronePlaceAnimRafRef.current[id];
        if (h != null) cancelAnimationFrame(h);
      });
      dronePlaceAnimRafRef.current = {};
      dronePlaceAnimActiveRef.current.clear();
      droneRemoveAnimActiveRef.current.clear();
      dronePlaceTargetKeyRef.current.clear();
      droneMarkerPositionKeyRef.current.clear();
      droneDragActiveRef.current.clear();
      if (mapInstanceRef.current) {
        try {
          Object.values(droneMarkersRef.current).forEach(marker => {
            try { mapInstanceRef.current.geoObjects.remove(marker); } catch { }
          });
          Object.values(routePolylinesRef.current).forEach(polyline => {
            try { mapInstanceRef.current.geoObjects.remove(polyline); } catch { }
          });
          if (editingPolylineRef.current) {
            try { mapInstanceRef.current.geoObjects.remove(editingPolylineRef.current); } catch { }
            editingPolylineRef.current = null;
          }
          if (previewPolylineRef.current) {
            try { mapInstanceRef.current.geoObjects.remove(previewPolylineRef.current); } catch { }
            previewPolylineRef.current = null;
          }
          if (zonePolygonRef.current) {
            try { mapInstanceRef.current.geoObjects.remove(zonePolygonRef.current); } catch { }
            zonePolygonRef.current = null;
          }
          if (draftRectPolygonRef.current) {
            if (draftRectGeometryChangeHandlerRef.current) {
              try {
                draftRectPolygonRef.current.geometry.events.remove('change', draftRectGeometryChangeHandlerRef.current);
              } catch { }
              draftRectGeometryChangeHandlerRef.current = null;
            }
            try { mapInstanceRef.current.geoObjects.remove(draftRectPolygonRef.current); } catch { }
            draftRectPolygonRef.current = null;
          }
          if (routeEditGeometryChangeHandlerRef.current && routeEditPolylineRef.current) {
            try {
              routeEditPolylineRef.current.geometry.events.remove('change', routeEditGeometryChangeHandlerRef.current);
            } catch { }
            routeEditGeometryChangeHandlerRef.current = null;
          }
          if (routeEditPolylineRef.current) {
            if (routeShiftPolylineClickHandlerRef.current) {
              try {
                routeEditPolylineRef.current.events.remove('click', routeShiftPolylineClickHandlerRef.current);
              } catch { /* ignore */ }
              routeShiftPolylineClickHandlerRef.current = null;
            }
            try { mapInstanceRef.current.geoObjects.remove(routeEditPolylineRef.current); } catch { }
            routeEditPolylineRef.current = null;
          }
          routeShiftHighlightPolylinesRef.current.forEach((pl) => {
            try {
              mapInstanceRef.current.geoObjects.remove(pl);
            } catch {
              /* ignore */
            }
          });
          routeShiftHighlightPolylinesRef.current = [];
          routeShiftDemoPolylinesRef.current.forEach((pl) => {
            try {
              mapInstanceRef.current.geoObjects.remove(pl);
            } catch {
              /* ignore */
            }
          });
          routeShiftDemoPolylinesRef.current = [];
          if (routeShiftDemoZonePolygonRef.current) {
            try {
              mapInstanceRef.current.geoObjects.remove(routeShiftDemoZonePolygonRef.current);
            } catch {
              /* ignore */
            }
            routeShiftDemoZonePolygonRef.current = null;
          }

          mapInstanceRef.current.destroy();
        } catch { }
        mapInstanceRef.current = null;
      }
      droneMarkersRef.current = {};
      routePolylinesRef.current = {};
      setMapLoaded(false);
    };
  }, []);

  if (error) {
    return (
      <div className="w-full h-[500px] bg-gray-800 rounded flex flex-col items-center justify-center p-4">
        <div className="text-red-500 text-2xl mb-2">⚠️</div>
        <h3 className="text-white font-bold mb-2">Ошибка загрузки карты</h3>
        <p className="text-gray-300 text-center mb-4">{error}</p>
        <button
          onClick={() => {
            setError(null);
            yandexMapsLoaded = false;
            yandexMapsLoading = false;
            droneMarkersRef.current = {};
            routePolylinesRef.current = {};
            initMap();
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
        >
          Перезагрузить карту
        </button>
      </div>
    );
  }

  const cursorAddPoint =
    placementMode ||
    routeEditMode ||
    drawRectZoneMode ||
    (editingPath && editingPath.length >= 0);

  const shiftCount = Array.isArray(routeShiftSegmentIndices) ? routeShiftSegmentIndices.length : 0;
  const onboardingRouteShiftStep = workspaceOnboardingStepId === 'route-shift-segments';
  const showRouteShiftUi =
    typeof onRouteShiftSegmentToggle === 'function' &&
    (onboardingRouteShiftStep ||
      (routeEditMode && Array.isArray(routeEditPath) && routeEditPath.length >= 2));

  const isSatelliteMap = mapType === YANDEX_MAP_TYPE_SATELLITE;

  const toggleMapType = () => {
    setMapType((prev) =>
      prev === YANDEX_MAP_TYPE_SATELLITE ? YANDEX_MAP_TYPE_SCHEME : YANDEX_MAP_TYPE_SATELLITE
    );
  };

  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded bg-gray-900 ${cursorAddPoint ? 'cursor-route-edit' : ''}`}
    >
      <div
        ref={mapContainerRef}
        className="h-full w-full"
        style={{
          height: '100%',
          width: '100%',
          cursor: cursorAddPoint ? 'crosshair' : 'grab',
        }}
      />
      {mapLoaded && (
        <div className="pointer-events-auto absolute bottom-3 right-3 z-[200]">
          <button
            type="button"
            onClick={toggleMapType}
            title={
              isSatelliteMap
                ? 'Переключить на схему (дороги и подписи)'
                : 'Переключить на спутниковые снимки'
            }
            aria-label={
              isSatelliteMap ? 'Показать схему карты' : 'Показать спутниковую карту'
            }
            className="rounded-xl border border-gray-500/70 bg-gray-900/90 px-3 py-2 min-h-[44px] text-sm font-medium text-gray-100 shadow-lg backdrop-blur-sm transition-colors hover:bg-gray-800/95"
          >
            {isSatelliteMap ? 'Схема' : 'Спутник'}
          </button>
        </div>
      )}
      {buildingsNotice && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-[210] w-[min(92vw,520px)] -translate-x-1/2 rounded-xl border border-amber-500/60 bg-amber-950/90 px-3 py-2 text-sm text-amber-100 shadow-xl backdrop-blur-sm">
          {buildingsNotice}
        </div>
      )}
      {showRouteShiftUi && (
        <>
          <div className="pointer-events-auto absolute bottom-24 right-3 z-[165] flex max-w-[min(92vw,360px)] items-center gap-2 sm:bottom-20">
            <button
              type="button"
              className={`rounded-xl border px-3 py-2 text-sm font-medium shadow-lg backdrop-blur-sm transition-colors ${
                routeShiftSelectionMode
                  ? 'border-fuchsia-400/80 bg-fuchsia-900/95 text-fuchsia-100 hover:bg-fuchsia-800/95'
                  : 'border-gray-500/70 bg-gray-900/90 text-gray-200 hover:bg-gray-800/95'
              }`}
              title={
                routeShiftSelectionMode
                  ? 'Режим смещений включён: клики выбирают только отрезки'
                  : 'Включить режим выбора отрезков смещения'
              }
              onClick={() => setRouteShiftSelectionMode((v) => !v)}
            >
              {routeShiftSelectionMode ? 'Режим смещений: ВКЛ' : 'Режим смещений'}
            </button>
            <button
              type="button"
              data-onboarding="route-shift-segments"
              className="max-w-[min(56vw,220px)] truncate rounded-xl border border-violet-500/60 bg-violet-950/90 px-3 py-2 text-left text-sm font-medium text-violet-100 shadow-lg backdrop-blur-sm hover:bg-violet-900/95"
              title="Список отрезков с меткой «смещение» между рядами"
              onClick={() => setRouteShiftPanelOpen(true)}
            >
              Смещения · {shiftCount}
            </button>
          </div>
          <RouteShiftSegmentsPopup
            open={routeShiftPanelOpen}
            onClose={() => setRouteShiftPanelOpen(false)}
            segmentIndices={routeShiftSegmentIndices}
            pathPointCount={onboardingRouteShiftStep ? 4 : routeEditPath.length}
            onboardingDemoActive={onboardingRouteShiftStep}
            onToggleSegment={(seg) => {
              onRouteShiftSegmentToggle(seg);
            }}
          />
        </>
      )}
    </div>
  );
}