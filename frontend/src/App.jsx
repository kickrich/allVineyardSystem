import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { SearchBox } from './components/Search_Box';
import { Sidebar } from './components/Sidebar';
import { ShabloneScreen } from './components/Shablone_Screen';
import { YandexMap } from './components/YandexMap';
import { ZoneMapMenu } from './components/ZoneMapMenu';
import { WorkspaceOnboarding } from './components/WorkspaceOnboarding';
import { DroneModal } from './components/Drone_OnClick_List_Sidebar';
import { DroneParking } from './components/Drone_Parking';
import { WeatherWidget } from './components/WeatherWidget';
import { AuthScreen } from './components/AuthScreen';
import { dronesData, initialMapCenter, flightStatus } from './constants/drones_data';
import { resetWorkspaceOnboardingForLogin } from './constants/onboarding';
import {
  fetchDronesFromBackend,
  fetchUsersFromBackend,
  fetchZonesFromBackend,
  fetchRouteTemplatesFromBackend,
  createRouteTemplateInBackend,
  updateRouteTemplateInBackend,
  deleteRouteTemplateInBackend,
  createDroneInBackend,
  createZoneWithKml,
  createZoneWithBoundary,
  updateZoneWithBoundary,
  deleteZoneInBackend,
  updateZoneWithKml,
  syncDroneStateToBackend,
  createMissionInBackend,
  addRoutePointToMissionInBackend,
  approveMissionInBackend,
  startMissionInBackend,
  completeMissionInBackend,
  cancelMissionInBackend,
  fetchActiveMissionsForDrone,
  postTelemetryToBackend,
  multipartInitForVideo,
  multipartPresignPart,
  multipartCompleteForVideo,
  multipartListParts,
  clearApiSession,
} from './api/backend';
import {
  calculateDistance,
  calculateFlightTime,
  calculateOptimalSpeed,
  calculateBearing
} from './utils/flightCalculator';

const VIEW_TRANSITION_MS = 900;
const EXIT_PANELS_MS = VIEW_TRANSITION_MS;
const DESKTOP_SWITCH_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const FIRST_WAYPOINT_TRANSIT_THRESHOLD_M = 10;
const ROUTE_ZONE_REJECT_LOG_COOLDOWN_MS = 1200;
const TEMPLATE_ROUTE_REJECT_COOLDOWN_MS = 1200;
const TELEMETRY_SEND_EVERY_MS = 1000;
const ZONE_COLORS_STORAGE_KEY = 'zone_colors_v1';

const VIDEO_CANVAS_WIDTH = 640;
const VIDEO_CANVAS_HEIGHT = 360;
const VIDEO_RECORDING_FPS = 15;
const VIDEO_BACKEND_CONTENT_TYPE = 'video/webm';
const VIDEO_RECORDER_MIME_CANDIDATES = ['video/webm;codecs=vp8', 'video/webm'];
const VIDEO_MULTIPART_CHUNK_SIZE_BYTES = 1024 * 1024; // >= 1MB (минимум в backend)

function hasStoredApiToken() {
  if (typeof window === 'undefined') return false;
  const t = localStorage.getItem('api_token');
  return Boolean(t && t.trim().length > 0);
}

function getStoredApiUser() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('api_user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user && typeof user === 'object' ? user : null;
  } catch {
    return null;
  }
}

function withRuntimeState(drone) {
  return {
    ...drone,
    position: null,
    path: [],
    isVisible: false,
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

function createLocalDrones() {
  return dronesData.map((drone) => withRuntimeState({ ...drone }));
}

function mapBackendDroneToFrontend(drone, index) {
  const fallback = dronesData[index % dronesData.length] ?? {};
  const batteryValue = Number(drone?.battery);
  return withRuntimeState({
    ...fallback,
    id: drone?.id ?? fallback.id ?? index + 1,
    name: drone?.name ?? fallback.name ?? `Дрон-${index + 1}`,
    model: drone?.model ?? fallback.model ?? 'Generic',
    battery: Number.isFinite(batteryValue) ? batteryValue : (fallback.battery ?? 100),
    backendStatus: drone?.status ?? 'idle'
  });
}

function isPointInsideZoneBoundary(boundary, point) {
  if (!Array.isArray(boundary) || boundary.length < 4 || !point) return false;
  const px = Number(point.lng);
  const py = Number(point.lat);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;

  const vertices = boundary.slice(0, -1);
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects =
      (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function normalizedTemplatePoints(path) {
  return Array.isArray(path)
    ? path.filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    : [];
}

function inferZoneIdForTemplatePath(path, zones) {
  const points = normalizedTemplatePoints(path);
  if (!Array.isArray(zones) || zones.length === 0) return null;
  if (zones.length === 1) {
    const onlyZoneId = zones[0]?.id;
    return onlyZoneId == null ? null : onlyZoneId;
  }
  if (points.length < 2) return null;

  let bestZoneId = null;
  let bestHits = 0;
  for (const z of zones) {
    const boundary = z?.boundary;
    const zid = z?.id;
    if (zid == null || !Array.isArray(boundary) || boundary.length < 4) continue;
    let hits = 0;
    for (const [lat, lng] of points) {
      if (isPointInsideZoneBoundary(boundary, { lat, lng })) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestZoneId = zid;
    }
  }
  if (bestZoneId != null && bestHits >= 1) return bestZoneId;
  return null;
}

function templateTouchesZone(templatePath, zoneBoundary) {
  const points = normalizedTemplatePoints(templatePath);
  if (!points.length || !Array.isArray(zoneBoundary) || zoneBoundary.length < 4) return false;
  return points.some(([lat, lng]) => isPointInsideZoneBoundary(zoneBoundary, { lat, lng }));
}

function collectSameZoneTemplateIds(templateId, templates, zones) {
  const list = Array.isArray(templates) ? templates : [];
  const zlist = Array.isArray(zones) ? zones : [];
  const base = list.find((t) => t.id === templateId);
  if (!base) return [];
  const resolveTemplateZoneId = (tpl) =>
    tpl?.zoneId ?? inferZoneIdForTemplatePath(tpl?.path, zlist);
  const baseZoneId = resolveTemplateZoneId(base);
  const baseBoundary =
    baseZoneId == null
      ? null
      : zlist.find((z) => String(z.id) === String(baseZoneId))?.boundary ?? null;

  return list
    .filter((t) => {
      if (baseZoneId == null) return t.id === templateId;
      const zId = resolveTemplateZoneId(t);
      if (zId != null && String(zId) === String(baseZoneId)) return true;
      return templateTouchesZone(t?.path, baseBoundary);
    })
    .map((t) => t.id);
}

function normalizeZoneName(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function nextZoneOrdinal(zones) {
  const list = Array.isArray(zones) ? zones : [];
  let max = 0;
  for (const z of list) {
    const name = String(z?.name ?? '').trim();
    const m = name.match(/^Зона\s*№\s*(\d+)/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

function zoneColorNameFromHex(colorHex = '#22c55e') {
  const m = String(colorHex).trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return 'цветной';
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  if (s < 0.14) {
    if (l <= 0.15) return 'чёрный';
    if (l >= 0.88) return 'белый';
    return 'серый';
  }

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  if (h < 15 || h >= 345) return 'красный';
  if (h < 40) return 'оранжевый';
  if (h < 62) return 'жёлтый';
  if (h < 150) return 'зелёный';
  if (h < 185) return 'бирюзовый';
  if (h < 210) return 'голубой';
  if (h < 255) return 'синий';
  if (h < 295) return 'фиолетовый';
  if (h < 345) return 'розовый';
  return 'цветной';
}

function buildAutoZoneName(zones, colorHex = '#22c55e') {
  let ord = nextZoneOrdinal(zones);
  const colorName = zoneColorNameFromHex(colorHex);
  const existing = new Set((Array.isArray(zones) ? zones : []).map((z) => normalizeZoneName(z?.name)));
  while (existing.has(normalizeZoneName(`Зона №${ord}("${colorName}")`))) {
    ord += 1;
  }
  return `Зона №${ord}("${colorName}")`;
}

function updateAutoZoneNameColor(name, colorHex = '#22c55e') {
  const m = String(name ?? '').trim().match(/^Зона\s*№\s*(\d+)\(".*"\)$/i);
  if (!m) return null;
  const ord = Number(m[1]);
  if (!Number.isFinite(ord)) return null;
  return `Зона №${ord}("${zoneColorNameFromHex(colorHex)}")`;
}

function nextRouteTemplateOrdinal(templates) {
  const list = Array.isArray(templates) ? templates : [];
  let max = 0;
  for (const t of list) {
    const name = String(t?.name ?? '').trim();
    const m = name.match(/^Маршрут\s*№\s*(\d+)/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

function buildAutoRouteTemplateName(templates) {
  let ord = nextRouteTemplateOrdinal(templates);
  const existing = new Set((Array.isArray(templates) ? templates : []).map((t) => String(t?.name ?? '').trim().toLocaleLowerCase()));
  while (existing.has(`маршрут №${ord}`.toLocaleLowerCase())) ord += 1;
  return `Маршрут №${ord}`;
}

function mapBackendTemplateToFrontend(template) {
  const id = template?.id;
  const rawPath = Array.isArray(template?.path) ? template.path : [];
  return {
    id: id != null ? String(id) : `tpl_${Date.now()}`,
    name: template?.name || 'Без названия',
    path: rawPath
      .map((point) => (Array.isArray(point) && point.length >= 2 ? [Number(point[0]), Number(point[1])] : null))
      .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])),
    zoneId: template?.zone_id ?? template?.zoneId ?? null,
  };
}

function App() {
  const [hasStarted, setHasStarted] = useState(false);
  const [exitingToTemplates, setExitingToTemplates] = useState(false);
  const [missionTemplates, setMissionTemplates] = useState([]);

  const [templateEditMode, setTemplateEditMode] = useState(null);
  const [templateDraftPath, setTemplateDraftPath] = useState([]);
  const [templateDraftName, setTemplateDraftName] = useState('');
  const [templateDraftZoneId, setTemplateDraftZoneId] = useState(null);
  const [noTransitionTemplateSwitch, setNoTransitionTemplateSwitch] = useState(false);

  useEffect(() => {
    if (!noTransitionTemplateSwitch) return;
    const id = requestAnimationFrame(() => {
      setNoTransitionTemplateSwitch(false);
    });
    return () => cancelAnimationFrame(id);
  }, [noTransitionTemplateSwitch]);

  const reloadMissionTemplates = useCallback(async () => {
    const templates = await fetchRouteTemplatesFromBackend();
    setMissionTemplates(templates.map(mapBackendTemplateToFrontend));
  }, []);

  const startCreateTemplate = useCallback(() => {
    setTemplateEditMode('create');
    setTemplateDraftPath([]);
    setTemplateDraftName('');
    setTemplateDraftZoneId(null);
  }, []);
  const startEditTemplateRoute = useCallback((id) => {
    const t = missionTemplates.find((x) => x.id === id);
    if (!t) return;
    setTemplateEditMode({ type: 'edit', id });
    setTemplateDraftPath([...(t.path || [])]);
    setTemplateDraftName(t.name || '');
    setTemplateDraftZoneId(t?.zoneId ?? null);
  }, [missionTemplates]);
  const cancelTemplateEdit = useCallback(() => {
    setNoTransitionTemplateSwitch(true);
    setTemplateEditMode(null);
    setTemplateDraftPath([]);
    setTemplateDraftName('');
    setTemplateDraftZoneId(null);
  }, []);
  const saveTemplateDraft = useCallback(async () => {
    const name = templateDraftName.trim() || buildAutoRouteTemplateName(missionTemplates);
    const draftZoneId = templateDraftZoneId ?? activeZoneIdRef.current ?? null;
    try {
      if (templateEditMode === 'create') {
        await createRouteTemplateInBackend({
          name,
          path: [...templateDraftPath],
          zoneId: draftZoneId,
        });
      } else if (templateEditMode && templateEditMode.type === 'edit') {
        const current = missionTemplates.find((t) => t.id === templateEditMode.id);
        await updateRouteTemplateInBackend(templateEditMode.id, {
          name,
          path: [...templateDraftPath],
          zoneId: draftZoneId ?? current?.zoneId ?? null,
        });
      } else {
        return;
      }
      await reloadMissionTemplates();
    } catch (err) {
      window.alert(String(err?.message ?? err));
      return;
    }
    setNoTransitionTemplateSwitch(true);
    setTemplateEditMode(null);
    setTemplateDraftPath([]);
    setTemplateDraftName('');
    setTemplateDraftZoneId(null);
  }, [templateEditMode, templateDraftName, templateDraftPath, templateDraftZoneId, missionTemplates, reloadMissionTemplates]);
  const addTemplateDraftPoint = useCallback((latlng) => {
    setTemplateDraftPath((prev) => [...prev, [latlng.lat, latlng.lng]]);
  }, []);
  const undoTemplateDraftPoint = useCallback(() => {
    setTemplateDraftPath((prev) => (prev.length ? prev.slice(0, -1) : []));
  }, []);

  const [templateToApplyId, setTemplateToApplyId] = useState(null);
  const computeMissionParamsFromPath = useCallback((path, maxSpeed = 70, battery = 100) => {
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
      totalTime: 0
    };
    missionParams.totalTime = missionParams.segmentTimes.reduce((sum, t) => sum + t, 0);
    return missionParams;
  }, []);

  const applyTemplateToDrone = useCallback((droneId, tplId) => {
    const tpl = missionTemplates.find((t) => t.id === tplId);
    if (!tpl || !tpl.path || !tpl.path.length) return;
    setDrones((prev) => {
      const path = tpl.path.map((p) => [p[0], p[1]]);
      const next = prev.map((d) =>
        d.id === droneId ? { ...d, path } : d
      );
      const drone = next.find((d) => d.id === droneId);
      if (drone && path.length >= 2) {
        const params = computeMissionParamsFromPath(path, drone.maxSpeed, drone.battery);
        return next.map((d) =>
          d.id === droneId ? { ...d, path, missionParameters: params } : d
        );
      }
      return next;
    });
    setTemplateToApplyId(null);
  }, [missionTemplates, computeMissionParamsFromPath]);

  const [drones, setDrones] = useState(() => createLocalDrones());
  const [backendSync, setBackendSync] = useState({ status: 'idle', message: '' });
  const [authReady, setAuthReady] = useState(hasStoredApiToken);
  const authUser = useMemo(() => getStoredApiUser(), [authReady]);
  const authUserLabel = useMemo(() => {
    if (authUser?.name && String(authUser.name).trim()) return String(authUser.name).trim();
    if (authUser?.email && String(authUser.email).trim()) return String(authUser.email).trim();
    if (authUser?.id != null) return `ID ${authUser.id}`;
    return 'пользователь';
  }, [authUser]);
  const backendContextRef = useRef({ userId: null, zoneId: null });
  const backendMissionIdsRef = useRef(new Map());

  const [backendZones, setBackendZones] = useState([]);
  const [activeZoneId, setActiveZoneId] = useState(null);
  const activeZoneIdRef = useRef(null);
  const routeZoneRejectLogAtRef = useRef(0);
  const templateRouteRejectAtRef = useRef(0);
  const [zoneColorsById, setZoneColorsById] = useState(() => {
    try {
      const raw = localStorage.getItem(ZONE_COLORS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed;
    } catch {
      return {};
    }
  });
  const [zoneFitNonce, setZoneFitNonce] = useState(0);
  const [newZoneKmlName, setNewZoneKmlName] = useState('Полигон из KML');
  const [zoneKmlBusy, setZoneKmlBusy] = useState(false);
  const [zoneKmlMessage, setZoneKmlMessage] = useState(null);
  const [zoneKmlIsError, setZoneKmlIsError] = useState(false);
  const zoneKmlInputRef = useRef(null);

  const [drawRectZoneMode, setDrawRectZoneMode] = useState(false);
  const [draftRectBoundary, setDraftRectBoundary] = useState(null);
  const [editingZoneId, setEditingZoneId] = useState(null);
  const [newRectZoneName, setNewRectZoneName] = useState('');
  const [draftRectZoneColor, setDraftRectZoneColor] = useState('#22c55e');
  const [rectZoneBusy, setRectZoneBusy] = useState(false);

  useEffect(() => {
    activeZoneIdRef.current = activeZoneId;
  }, [activeZoneId]);

  useEffect(() => {
    if (templateEditMode) return;
    setDrawRectZoneMode(false);
    setEditingZoneId(null);
    setDraftRectBoundary(null);
  }, [templateEditMode]);

  const activeZoneBoundary = useMemo(() => {
    const z = backendZones.find((x) => x.id === activeZoneId);
    return Array.isArray(z?.boundary) ? z.boundary : null;
  }, [backendZones, activeZoneId]);
  const zonesForMap = useMemo(
    () =>
      backendZones
        .filter((z) => Array.isArray(z?.boundary) && z.boundary.length >= 4)
        .map((z) => ({
          id: z.id,
          boundary: z.boundary,
          color:
            (typeof z?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(z.color))
              ? z.color
              : (/^#[0-9a-fA-F]{6}$/.test(zoneColorsById[String(z.id)]) ? zoneColorsById[String(z.id)] : '#22c55e'),
          isActive: z.id === activeZoneId,
        })),
    [backendZones, zoneColorsById, activeZoneId]
  );
  const activeZoneColor = useMemo(() => {
    if (activeZoneId == null) return '#22c55e';
    const backendColor = backendZones.find((z) => String(z.id) === String(activeZoneId))?.color;
    if (typeof backendColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(backendColor)) {
      return backendColor;
    }
    const saved = zoneColorsById[String(activeZoneId)];
    return /^#[0-9a-fA-F]{6}$/.test(saved) ? saved : '#22c55e';
  }, [activeZoneId, zoneColorsById, backendZones]);

  const workZoneReady = useMemo(
    () => Array.isArray(activeZoneBoundary) && activeZoneBoundary.length >= 4,
    [activeZoneBoundary]
  );
  const templateUsageByZoneId = useMemo(() => {
    const byId = {};
    const zones = Array.isArray(backendZones) ? backendZones : [];
    const templates = Array.isArray(missionTemplates) ? missionTemplates : [];
    for (const t of templates) {
      const zid = t?.zoneId ?? inferZoneIdForTemplatePath(t?.path, zones);
      if (zid == null) continue;
      const key = String(zid);
      byId[key] = Number(byId[key] || 0) + 1;
    }
    return byId;
  }, [backendZones, missionTemplates]);

  useEffect(() => {
    if (!Array.isArray(backendZones) || backendZones.length === 0) return;
    setMissionTemplates((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        if (t?.zoneId != null) return t;
        const inferred = inferZoneIdForTemplatePath(t?.path, backendZones);
        if (inferred == null) return t;
        changed = true;
        return { ...t, zoneId: inferred };
      });
      return changed ? next : prev;
    });
  }, [backendZones]);
  useEffect(() => {
    try {
      localStorage.setItem(ZONE_COLORS_STORAGE_KEY, JSON.stringify(zoneColorsById));
    } catch {}
  }, [zoneColorsById]);

  useEffect(() => {
    if (!backendZones.length) return;
    const validIds = new Set(backendZones.map((z) => String(z.id)));
    setZoneColorsById((prev) => {
      let changed = false;
      const next = {};
      backendZones.forEach((z) => {
        const id = String(z.id);
        const backendColor = typeof z?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(z.color) ? z.color : null;
        const localColor = prev[id];
        const resolved = backendColor ?? (typeof localColor === 'string' ? localColor : '#22c55e');
        next[id] = resolved;
        if (prev[id] !== resolved) changed = true;
      });
      Object.keys(prev).forEach((id) => {
        if (!validIds.has(id)) changed = true;
      });
      return changed ? next : prev;
    });
  }, [backendZones]);

  const dronesRef = useRef(drones);
  useEffect(() => {
    dronesRef.current = drones;
  }, [drones]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    let cancelled = false;

    const bootstrapBackend = async () => {
      setBackendSync({ status: 'loading', message: '' });
      try {
        const backendDrones = await fetchDronesFromBackend();
        try {
          const zones = await fetchZonesFromBackend();
          const templates = await fetchRouteTemplatesFromBackend();
          setBackendZones(zones);
          setMissionTemplates(templates.map(mapBackendTemplateToFrontend));
          let userId = null;
          try {
            const raw = localStorage.getItem('api_user');
            if (raw) {
              const me = JSON.parse(raw);
              if (me?.id != null) userId = me.id;
            }
          } catch {}
          if (userId == null) {
            const users = await fetchUsersFromBackend();
            if (users.length > 0) userId = users[0].id;
          }
          if (userId != null && zones.length > 0) {
            setActiveZoneId((prev) => {
              const next =
                prev != null && zones.some((z) => z.id === prev) ? prev : zones[0].id;
              backendContextRef.current = { userId, zoneId: next };
              return next;
            });
          } else {
            setActiveZoneId(null);
            backendContextRef.current = {
              ...backendContextRef.current,
              zoneId: null,
            };
          }
        } catch (e) {
          console.warn('Backend user/zone контекст недоступен:', e?.message ?? e);
        }
        if (cancelled) return;

        if (backendDrones.length > 0) {
          setDrones(backendDrones.map(mapBackendDroneToFrontend));
          setBackendSync({
            status: 'connected',
            message: ''
          });
        } else {
          setBackendSync({
            status: 'connected-empty',
            message: ''
          });
        }
      } catch (error) {
        if (cancelled) return;
        if (!localStorage.getItem('api_token')) {
          setAuthReady(false);
        }
        setBackendSync({
          status: 'error',
          message: ''
        });
      }
    };

    bootstrapBackend();
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  const [mapCenter, setMapCenter] = useState(initialMapCenter);
  const [selectedDroneForModal, setSelectedDroneForModal] = useState(null);
  const [mapZoom, setMapZoom] = useState(13);
  const [globalMissionLog, setGlobalMissionLog] = useState([]);
  const [weatherFlightSafe, setWeatherFlightSafe] = useState(true);
  const [weatherFlightReasons, setWeatherFlightReasons] = useState([]);
  const activeTimersRef = useRef(new Map());

  const telemetryLastSentAtRef = useRef(new Map());
  const telemetrySendingRef = useRef(new Map());

  const videoRecordingByDroneRef = useRef(new Map());
  const videoUploadInProgressRef = useRef(new Map());

  const stopVideoRecordingForDrone = async (droneId) => {
    const rec = videoRecordingByDroneRef.current.get(droneId);
    if (!rec) return null;

    videoRecordingByDroneRef.current.delete(droneId);

    try {
      if (rec?.recorder && rec.recorder.state !== 'inactive') {
        rec.recorder.stop();
      }
    } catch (e) {}

    try {
      return await rec.blobPromise;
    } catch (e) {
      console.warn('stopVideoRecordingForDrone blob error:', e?.message ?? e);
      return null;
    }
  };

  const uploadVideoMultipartForMission = async ({ missionId, droneId, blob }) => {
    if (missionId == null) return;
    if (!blob || blob.size <= 0) return;
    if (videoUploadInProgressRef.current.get(droneId)) return;

    videoUploadInProgressRef.current.set(droneId, true);
    try {
      const filename = `mission_${missionId}_drone_${droneId}_${Date.now()}.webm`;
      const init = await multipartInitForVideo({
        missionId,
        filename,
        byteSize: blob.size,
        contentType: VIDEO_BACKEND_CONTENT_TYPE,
        chunkSizeBytes: VIDEO_MULTIPART_CHUNK_SIZE_BYTES,
      });

      const uploadSessionId = init?.upload_session_id;
      const totalParts = init?.total_parts;
      const chunkSizeBytes = init?.chunk_size_bytes;
      if (!uploadSessionId || !Number.isFinite(totalParts) || !Number.isFinite(chunkSizeBytes)) {
        throw new Error('multipart_init returned unexpected data');
      }

      for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
        const presign = await multipartPresignPart({
          uploadSessionId,
          partNumber,
        });

        const start = (partNumber - 1) * chunkSizeBytes;
        const end = Math.min(start + chunkSizeBytes, blob.size);
        const partBlob = blob.slice(start, end);

        const headers = presign?.headers ?? {};
        const putRes = await fetch(presign.url, {
          method: 'PUT',
          headers,
          body: partBlob,
        });
        if (!putRes.ok) {
          throw new Error(`PUT part ${partNumber} failed with ${putRes.status}`);
        }
      }

      const list = await multipartListParts({ uploadSessionId });
      const uploadedParts = Array.isArray(list?.uploaded_parts) ? list.uploaded_parts : [];
      const parts = uploadedParts
        .map((p) => ({
          part_number: p.part_number,
          etag: p.etag,
        }))
        .filter((p) => Number.isFinite(p.part_number) && typeof p.etag === 'string')
        .sort((a, b) => a.part_number - b.part_number);

      if (!parts.length) {
        throw new Error('multipart_list_parts returned empty uploaded_parts');
      }

      await multipartCompleteForVideo({
        uploadSessionId,
        parts,
      });
    } finally {
      videoUploadInProgressRef.current.delete(droneId);
    }
  };

  const handleWeatherFlightConditions = useCallback((conditions) => {
    setWeatherFlightSafe(conditions.safe);
    setWeatherFlightReasons(conditions.reasons || []);
  }, []);

  const [placementMode, setPlacementMode] = useState(false);
  const [droneToPlace, setDroneToPlace] = useState(null);
  const [isRouteEditMode, setIsRouteEditMode] = useState(false);
  const [selectedDroneForSidebar, setSelectedDroneForSidebar] = useState(null);
  const selectedRouteEditPath = useMemo(() => {
    if (selectedDroneForSidebar == null) return null;
    const d = drones.find((x) => x.id === selectedDroneForSidebar);
    if (!d?.path?.length) return [];
    return d.path;
  }, [drones, selectedDroneForSidebar]);

  const [routeShiftSegmentsByDroneId, setRouteShiftSegmentsByDroneId] = useState({});

  const selectedRouteShiftSegments = useMemo(() => {
    if (selectedDroneForSidebar == null) return [];
    const raw = routeShiftSegmentsByDroneId[String(selectedDroneForSidebar)];
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
  }, [routeShiftSegmentsByDroneId, selectedDroneForSidebar]);

  useEffect(() => {
    if (selectedDroneForSidebar == null) return;
    const drone = drones.find((d) => d.id === selectedDroneForSidebar);
    const len = drone?.path?.length ?? 0;
    const maxSeg = len >= 2 ? len - 2 : -1;
    const id = String(selectedDroneForSidebar);
    setRouteShiftSegmentsByDroneId((prev) => {
      const cur = prev[id];
      if (!Array.isArray(cur) || !cur.length) return prev;
      if (maxSeg < 0) {
        if (!cur.length) return prev;
        const copy = { ...prev };
        delete copy[id];
        return copy;
      }
      const next = cur.filter((i) => i >= 0 && i <= maxSeg);
      if (next.length === cur.length) return prev;
      const copy = { ...prev };
      if (!next.length) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  }, [drones, selectedDroneForSidebar]);

  const toggleRouteShiftSegment = useCallback(
    (segmentIndex) => {
      if (selectedDroneForSidebar == null) return;
      const drone = drones.find((d) => d.id === selectedDroneForSidebar);
      const n = drone?.path?.length ?? 0;
      if (n < 2 || !Number.isInteger(segmentIndex)) return;
      if (segmentIndex < 0 || segmentIndex > n - 2) return;
      const id = String(selectedDroneForSidebar);
      setRouteShiftSegmentsByDroneId((prev) => {
        const cur = [...(prev[id] || [])];
        const j = cur.indexOf(segmentIndex);
        if (j >= 0) cur.splice(j, 1);
        else cur.push(segmentIndex);
        cur.sort((a, b) => a - b);
        return { ...prev, [id]: cur };
      });
    },
    [selectedDroneForSidebar, drones]
  );

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [parkingOpen, setParkingOpen] = useState(false);
  const [workspaceTourOpen, setWorkspaceTourOpen] = useState(false);
  const [workspaceOnboardingStepId, setWorkspaceOnboardingStepId] = useState(null);

  const createDroneFromParking = useCallback(async (nameFromModal) => {
    const suffix = `${Date.now()}`.slice(-6);
    const trimmed =
      typeof nameFromModal === 'string' ? nameFromModal.trim().slice(0, 120) : '';
    const name = trimmed.length > 0 ? trimmed : `Дрон ${suffix}`;
    try {
      await createDroneInBackend({ name, model: 'DJI Mavic 3', battery: 100, status: 'idle' });
      const backendDrones = await fetchDronesFromBackend();
      if (backendDrones.length > 0) {
        setDrones(backendDrones.map(mapBackendDroneToFrontend));
        setBackendSync({
          status: 'connected',
          message: ''
        });
      }
    } catch (e) {
      console.warn('createDroneFromParking failed:', e?.message ?? e);
      throw e;
    }
  }, []);

  useEffect(() => {
    if (!templateToApplyId || selectedDroneForSidebar == null) return;
    const drone = drones.find((d) => d.id === selectedDroneForSidebar);
    if (!drone || !drone.isVisible) return;
    if (drone.isFlying) return;
    applyTemplateToDrone(selectedDroneForSidebar, templateToApplyId);
  }, [templateToApplyId, selectedDroneForSidebar, drones, applyTemplateToDrone]);

  const startDronePlacement = (droneId) => {
    setDroneToPlace(droneId);
    setPlacementMode(true);
  };

  const placeDroneOnMap = (latlng) => {
    if (!droneToPlace || !placementMode) return;
    const drone = drones.find(d => d.id === droneToPlace);
    if (!drone) return;

    const positionToSet = {
      lat: latlng.lat,
      lng: latlng.lng
    };

    setDrones(prev =>
      prev.map(d => {
        if (d.id !== droneToPlace) return d;
        return {
          ...d,
          position: positionToSet,
          isVisible: true,
          battery: 100,
          status: 'на земле',
          flightStatus: flightStatus.IDLE,
          speed: 0,
          altitude: 0,
          path: [],
          missionParameters: null,
          flightProgress: 0,
          currentWaypointIndex: 0,
          flightLog: []
        };
      })
    );
    setSelectedDroneForSidebar(droneToPlace);
    setPlacementMode(false);
    setDroneToPlace(null);
    addToGlobalLog(droneToPlace, `🛸 Дрон "${drone.name}" размещен на карте`, {
      coordinates: `lat: ${positionToSet.lat.toFixed(6)}, lng: ${positionToSet.lng.toFixed(6)}`
    });
    void syncDroneStateToBackend(droneToPlace, { status: 'idle', battery: 100 }).catch((e) =>
      console.warn('PATCH drone (размещение):', e?.message ?? e)
    );
  };

  const cancelDronePlacement = () => {
    setPlacementMode(false);
    setDroneToPlace(null);
  };

  const removeDroneFromMap = (droneId) => {
    if (drones.find(d => d.id === droneId)?.flightStatus === flightStatus.FLYING) {
      stopDroneFlight(droneId);
    }

    const timerId = activeTimersRef.current.get(droneId);
    if (timerId) {
      clearInterval(timerId);
      activeTimersRef.current.delete(droneId);
    }

    const drone = drones.find(d => d.id === droneId);

    setDrones(prev =>
      prev.map(d => {
        if (d.id !== droneId) return d;
        return {
          ...d,
          isVisible: false,
          path: [],
          flightStatus: flightStatus.IDLE,
          isFlying: false,
          missionParameters: null,
          missionTimerId: null,
          missionStartTime: null,
          missionElapsedTime: 0,
          flightLog: []
        };
      })
    );
    if (selectedDroneForSidebar === droneId) {
      setSelectedDroneForSidebar(null);
      setIsRouteEditMode(false);
    }
    if (drone) {
      addToGlobalLog(droneId, `🗑️ Дрон "${drone.name}" убран с карты`);
    }
    void syncDroneStateToBackend(droneId, { status: 'offline' }).catch((e) =>
      console.warn('PATCH drone (убрать с карты):', e?.message ?? e)
    );
  };

  const handleMapClick = (latlng) => {
    if (drawRectZoneMode) {
      return;
    }
    if (editingZoneId != null || draftRectBoundary?.length) {
      setEditingZoneId(null);
      setDraftRectBoundary(null);
      return;
    }
    if (templateEditMode) {
      if (!Array.isArray(activeZoneBoundary) || activeZoneBoundary.length < 4) {
        return;
      }
      if (!isPointInsideZoneBoundary(activeZoneBoundary, latlng)) {
        return;
      }
      addTemplateDraftPoint(latlng);
      return;
    }
    if (placementMode && droneToPlace) {
      placeDroneOnMap(latlng);
      return;
    }
    if (selectedDroneForSidebar !== null && isRouteEditMode) {
      const drone = drones.find(d => d.id === selectedDroneForSidebar);
      if (drone && !drone.isFlying) {
        if (!Array.isArray(activeZoneBoundary) || activeZoneBoundary.length < 4) {
          addToDroneLog(selectedDroneForSidebar, '⚠️ Нельзя строить маршрут: сначала выберите активную зону');
          return;
        }
        if (!isPointInsideZoneBoundary(activeZoneBoundary, latlng)) {
          addToDroneLog(selectedDroneForSidebar, '⚠️ Точку можно поставить только внутри активной зоны');
          return;
        }
        addRoutePoint(selectedDroneForSidebar, latlng);
      }
      return;
    }
  };

  const handleTemplateRoutePathChange = useCallback((nextPath) => {
    if (!Array.isArray(nextPath)) return;
    const normalizedPath = nextPath
      .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [p[0], p[1]]);
    if (
      Array.isArray(activeZoneBoundary) &&
      activeZoneBoundary.length >= 4 &&
      normalizedPath.some(([lat, lng]) => !isPointInsideZoneBoundary(activeZoneBoundary, { lat, lng }))
    ) {
      const now = Date.now();
      if (now - templateRouteRejectAtRef.current > TEMPLATE_ROUTE_REJECT_COOLDOWN_MS) {
        templateRouteRejectAtRef.current = now;
      }
      return;
    }
    templateRouteRejectAtRef.current = 0;
    setTemplateDraftPath(normalizedPath);
  }, [activeZoneBoundary]);

  const handleDronePositionChange = useCallback((droneId, nextPosition) => {
    if (droneId == null || !nextPosition) return;
    const lat = Number(nextPosition.lat);
    const lng = Number(nextPosition.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setDrones((prev) =>
      prev.map((d) =>
        d.id === droneId
          ? { ...d, position: { lat, lng } }
          : d
      )
    );
  }, []);

  const addRoutePoint = (droneId, latlng) => {
    setDrones(prev =>
      prev.map(d =>
        d.id === droneId ? {
          ...d,
          path: [...d.path, [latlng.lat, latlng.lng]]
        } : d
      )
    );
    setTimeout(() => {
      const missionParams = calculateMissionParameters(droneId);
      if (missionParams) {
        setDrones(prev =>
          prev.map(d => {
            if (d.id !== droneId) return d;
            return {
              ...d,
              missionParameters: missionParams
            };
          })
        );
        addToDroneLog(droneId, '📍 Добавлена точка маршрута', {
          pointNumber: drones.find(d => d.id === droneId)?.path?.length || 0,
          coordinates: `lat: ${latlng.lat.toFixed(6)}, lng: ${latlng.lng.toFixed(6)}`
        });
      }
    }, 0);
  };

  const handleRoutePathChange = useCallback((nextPath) => {
    if (selectedDroneForSidebar == null || !Array.isArray(nextPath)) return;
    const normalizedPath = nextPath
      .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [p[0], p[1]]);

    if (
      Array.isArray(activeZoneBoundary) &&
      activeZoneBoundary.length >= 4 &&
      normalizedPath.some(([lat, lng]) => !isPointInsideZoneBoundary(activeZoneBoundary, { lat, lng }))
    ) {
      const now = Date.now();
      if (now - routeZoneRejectLogAtRef.current > ROUTE_ZONE_REJECT_LOG_COOLDOWN_MS) {
        routeZoneRejectLogAtRef.current = now;
        addToDroneLog(selectedDroneForSidebar, '⚠️ Маршрут должен оставаться внутри активной зоны');
      }
      return;
    }
    routeZoneRejectLogAtRef.current = 0;

    setDrones((prev) =>
      prev.map((d) => {
        if (d.id !== selectedDroneForSidebar) return d;
        const missionParams = computeMissionParamsFromPath(normalizedPath, d.maxSpeed, d.battery);
        return {
          ...d,
          path: normalizedPath,
          missionParameters: missionParams ?? d.missionParameters,
        };
      })
    );
  }, [selectedDroneForSidebar, computeMissionParamsFromPath, activeZoneBoundary]);

  const handleToggleRouteMode = () => {
    if (isRouteEditMode) {
      setIsRouteEditMode(false);
      return;
    }
    if (!selectedDroneForSidebar) {
      addToZoneLog('ℹ️ Сначала выберите дрон в списке панели (шаг 2).');
      return;
    }
    if (!Array.isArray(activeZoneBoundary) || activeZoneBoundary.length < 4) {
      addToDroneLog(
        selectedDroneForSidebar,
        '⚠️ Нужна активная зона с контуром на карте (шаг 1: меню зон слева или создание зоны).'
      );
      return;
    }
    setIsRouteEditMode(true);
  };

  const undoLastPoint = (droneId) => {
    if (!droneId) droneId = selectedDroneForSidebar;
    if (!droneId) return;

    const drone = drones.find(d => d.id === droneId);
    if (!drone || !drone.path || drone.path.length === 0) return;

    setDrones(prev =>
      prev.map(d =>
        d.id === droneId ? { ...d, path: d.path.slice(0, -1) } : d
      )
    );

    addToDroneLog(droneId, '↩️ Отменена последняя точка маршрута');
  };

  const clearRoute = (droneId) => {
    if (!droneId) droneId = selectedDroneForSidebar;
    if (!droneId) return;

    const drone = drones.find(d => d.id === droneId);
    if (!drone || !drone.path || drone.path.length === 0) return;

    setDrones(prev =>
      prev.map(d =>
        d.id === droneId ? {
          ...d,
          path: [],
          missionParameters: null
        } : d
      )
    );
    addToDroneLog(droneId, '🗑️ Маршрут очищен');
  };

  const calculateMissionParameters = (droneId) => {
    const drone = drones.find(d => d.id === droneId);
    if (!drone || !drone.path || drone.path.length < 2) return null;

    let totalDistance = 0;
    const distances = [];

    for (let i = 0; i < drone.path.length - 1; i++) {
      const [lat1, lng1] = drone.path[i];
      const [lat2, lng2] = drone.path[i + 1];
      const distance = calculateDistance(lat1, lng1, lat2, lng2);
      totalDistance += distance;
      distances.push(distance);
    }

    const optimalSpeed = calculateOptimalSpeed(totalDistance, drone.maxSpeed / 3.6);
    const flightTime = calculateFlightTime(totalDistance, optimalSpeed);
    const batteryConsumption = Math.min(totalDistance / 100, drone.battery - 10);

    const missionParams = {
      totalDistance: Math.round(totalDistance),
      optimalSpeed: Math.round(optimalSpeed * 3.6),
      estimatedTime: Math.round(flightTime),
      batteryConsumption: Math.round(batteryConsumption),
      waypoints: drone.path.length,
      distances,
      segmentTimes: distances.map(distance =>
        Math.max(1000, (distance / optimalSpeed) * 1000)
      ),
      totalTime: 0
    };

    missionParams.totalTime = missionParams.segmentTimes.reduce((sum, time) => sum + time, 0);
    return missionParams;
  };

  const addToDroneLog = (droneId, message, data = {}) => {
    const drone = drones.find(d => d.id === droneId);
    const logEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      message,
      data
    };

    setDrones(prev =>
      prev.map(d => {
        if (d.id !== droneId) return d;
        return {
          ...d,
          flightLog: [logEntry, ...d.flightLog].slice(0, 20)
        };
      })
    );
    const safeData = {};
    Object.keys(data).forEach(key => {
      if (typeof data[key] === 'object' && data[key] !== null) {
        safeData[key] = JSON.stringify(data[key]);
      } else {
        safeData[key] = data[key];
      }
    });

    addToGlobalLog(droneId, message, safeData);
  };

  const addToGlobalLog = (droneId, message, data = {}) => {
    const drone = drones.find(d => d.id === droneId);
    const safeData = {};
    Object.keys(data).forEach(key => {
      if (typeof data[key] === 'object' && data[key] !== null) {
        safeData[key] = JSON.stringify(data[key]);
      } else {
        safeData[key] = data[key];
      }
    });

    const globalLogEntry = {
      id: Date.now(),
      droneId,
      droneName: drone?.name || 'Неизвестный дрон',
      timestamp: new Date().toISOString(),
      message,
      data: safeData
    };

    setGlobalMissionLog(prev => [globalLogEntry, ...prev].slice(0, 100));
  };

  const addToZoneLog = useCallback((message, data = {}) => {
    const safeData = {};
    Object.keys(data).forEach((key) => {
      if (typeof data[key] === 'object' && data[key] !== null) {
        safeData[key] = JSON.stringify(data[key]);
      } else {
        safeData[key] = data[key];
      }
    });
    const zoneLogEntry = {
      id: Date.now(),
      droneId: null,
      droneName: 'Редактор зон',
      timestamp: new Date().toISOString(),
      message,
      data: safeData,
    };
    setGlobalMissionLog((prev) => [zoneLogEntry, ...prev].slice(0, 100));
  }, []);

  const hydrateBackendContext = useCallback(async () => {
    const zones = await fetchZonesFromBackend();
    setBackendZones(zones);
    if (!zones.length) {
      throw new Error('В backend нет зон (нужна zone с boundary для маршрутов)');
    }
    let userId = null;
    try {
      const raw = localStorage.getItem('api_user');
      if (raw) {
        const me = JSON.parse(raw);
        if (me?.id != null) userId = me.id;
      }
    } catch {}
    if (userId == null) {
      const users = await fetchUsersFromBackend();
      if (!users.length) {
        throw new Error('В backend нет пользователей');
      }
      userId = users[0].id;
    }
    let zoneId = activeZoneIdRef.current;
    if (zoneId == null || !zones.some((z) => z.id === zoneId)) {
      zoneId = zones[0].id;
      setActiveZoneId(zoneId);
      setZoneFitNonce((n) => n + 1);
    }
    const ctx = { userId, zoneId };
    backendContextRef.current = ctx;
    return ctx;
  }, []);

  const createAndStartBackendMission = useCallback(async (drone, routePath) => {
    try {
      let ctx = backendContextRef.current;
      if (!ctx?.userId || !ctx?.zoneId) {
        ctx = await hydrateBackendContext();
      }
      const createOnce = async () => createMissionInBackend({
        userId: ctx.userId,
        zoneId: ctx.zoneId,
        droneId: drone.id,
        missionType: 'monitoring',
      });

      let mission;
      try {
        mission = await createOnce();
      } catch (e) {
        const msg = String(e?.message ?? e);
        if (msg.includes('уже назначен')) {
          try {
            const active = await fetchActiveMissionsForDrone(drone.id);
            for (const m of active) {
              if (m?.id != null) {
                try {
                  await cancelMissionInBackend(m.id);
                } catch (cancelErr) {
                  console.warn('auto-cancel active mission failed:', cancelErr?.message ?? cancelErr);
                }
              }
            }
          } catch (listErr) {
            console.warn('fetchActiveMissionsForDrone failed:', listErr?.message ?? listErr);
          }
          mission = await createOnce();
        } else {
          throw e;
        }
      }
      const missionId = mission?.id;
      if (!missionId) {
        throw new Error('Backend не вернул id миссии');
      }
      const speedMps = Math.max(0, Number(drone.maxSpeed ?? 0) / 3.6);
      for (let i = 0; i < routePath.length; i += 1) {
        await addRoutePointToMissionInBackend(missionId, routePath[i], i, speedMps);
      }
      await approveMissionInBackend(missionId);
      await startMissionInBackend(missionId);
      backendMissionIdsRef.current.set(drone.id, missionId);
      void syncDroneStateToBackend(drone.id, { battery: drone.battery }).catch((e) =>
        console.warn('PATCH drone (battery после start):', e?.message ?? e)
      );
    } catch (error) {
      console.warn('Синхронизация миссии с backend:', error?.message ?? error);
      addToGlobalLog(drone.id, '⚠️ Миссия не синхронизирована с backend', {
        error: String(error?.message ?? error),
      });
    }
  }, [hydrateBackendContext, addToGlobalLog, fetchActiveMissionsForDrone]);

  const completeBackendMissionForDrone = useCallback(async (droneId) => {
    const missionId = backendMissionIdsRef.current.get(droneId);
    if (!missionId) return;
    try {
      await completeMissionInBackend(missionId);
      backendMissionIdsRef.current.delete(droneId);
    } catch (e) {
      console.warn('complete mission:', e?.message ?? e);
    }
  }, []);

  const cancelBackendMissionForDrone = useCallback(async (droneId) => {
    const missionId = backendMissionIdsRef.current.get(droneId);
    if (!missionId) return;
    try {
      await cancelMissionInBackend(missionId);
      backendMissionIdsRef.current.delete(droneId);
    } catch (e) {
      console.warn('cancel mission:', e?.message ?? e);
    }
  }, []);

  const isDroneAtMissionStart = useCallback((drone) => {
    if (!drone?.path || drone.path.length < 2 || !drone.position) return false;
    const first = drone.path[0];
    if (!Array.isArray(first) || first.length < 2) return false;
    return (
      calculateDistance(drone.position.lat, drone.position.lng, first[0], first[1]) <=
      FIRST_WAYPOINT_TRANSIT_THRESHOLD_M
    );
  }, []);

  const startDroneFlight = useCallback((droneId) => {
    const drone = drones.find(d => d.id === droneId);
    if (!drone || !drone.path || drone.path.length < 2) {
      console.warn('Start flight blocked: route needs >= 2 points');
      return;
    }

    if (drone.flightStatus === flightStatus.FLYING || drone.flightStatus === flightStatus.TAKEOFF || drone.flightStatus === flightStatus.LANDING) {
      console.warn('Start flight blocked: already flying');
      return;
    }

    if (!isDroneAtMissionStart(drone)) {
      console.warn('Start flight blocked: drone must be at first waypoint');
      return;
    }

    const flightPath = drone.path;

    const missionParams = computeMissionParamsFromPath(
      flightPath,
      drone.maxSpeed,
      drone.battery
    );
    if (!missionParams) return;

    if (drone.battery < missionParams.batteryConsumption + 10) {
      console.warn('Start flight blocked: low battery', {
        requiredMin: missionParams.batteryConsumption + 10,
        available: drone.battery
      });
      return;
    }
    if (selectedDroneForSidebar === droneId && isRouteEditMode) {
      setIsRouteEditMode(false);
    }

    setDrones(prev =>
      prev.map(d => {
        if (d.id !== droneId) return d;
        return {
          ...d,
          flightStatus: flightStatus.FLYING,
          isFlying: true,
          altitude: 100,
          currentMission: {
            startTime: new Date().toISOString(),
            totalWaypoints: d.path.length,
            totalDistance: missionParams.totalDistance,
            estimatedTime: missionParams.estimatedTime,
            missionParams,
            flightPath
          },
          currentWaypointIndex: 0,
          flightProgress: 0,
          speed: missionParams.optimalSpeed / 3.6,
          heading: 0,
          missionParameters: missionParams,
          missionStartTime: Date.now(),
          missionElapsedTime: 0
        };
      })
    );

    addToDroneLog(droneId, '🚀 Старт миссии', {
      waypoints: drone.path.length,
      totalDistance: missionParams.totalDistance,
      estimatedTime: missionParams.estimatedTime
    });
    void createAndStartBackendMission(drone, drone.path);
    addToDroneLog(droneId, '🛸 Старт с первой точки маршрута');
    setTimeout(() => startFlightMovement(droneId), 0);
  }, [
    drones,
    selectedDroneForSidebar,
    isRouteEditMode,
    addToDroneLog,
    computeMissionParamsFromPath,
    createAndStartBackendMission,
    isDroneAtMissionStart,
  ]);

  const startFlightMovement = (droneId) => {
    const drone = dronesRef.current.find(d => d.id === droneId);
    if (!drone || !drone.missionParameters) return;

    const missionParams = drone.missionParameters;
    let startTime;

    if (drone.missionElapsedTime > 0) {
      startTime = Date.now() - drone.missionElapsedTime;
    } else {
      startTime = Date.now();
    }

    const existingTimer = activeTimersRef.current.get(droneId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    telemetryLastSentAtRef.current.set(droneId, 0);
    telemetrySendingRef.current.set(droneId, false);

    let videoCtx = null;
    try {
      if (typeof document !== 'undefined' && typeof MediaRecorder !== 'undefined' && document.createElement) {
        const canvas = document.createElement('canvas');
        canvas.width = VIDEO_CANVAS_WIDTH;
        canvas.height = VIDEO_CANVAS_HEIGHT;

        const ctx = canvas.getContext('2d');
        if (ctx && canvas.captureStream) {
          videoCtx = ctx;
          const stream = canvas.captureStream(VIDEO_RECORDING_FPS);

          const recorderMimeType = VIDEO_RECORDER_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
          const options = recorderMimeType ? { mimeType: recorderMimeType } : undefined;

          const recorder = new MediaRecorder(stream, options);
          const chunks = [];

          let resolveBlob;
          const blobPromise = new Promise((resolve) => {
            resolveBlob = resolve;
          });

          recorder.ondataavailable = (e) => {
            if (e?.data && e.data.size > 0) chunks.push(e.data);
          };
          recorder.onstop = () => {
            const blobType = VIDEO_BACKEND_CONTENT_TYPE;
            const blob = new Blob(chunks, { type: blobType });
            resolveBlob(blob);
          };

          recorder.start(1000); // chunks every 1s
          videoRecordingByDroneRef.current.set(droneId, {
            recorder,
            blobPromise,
          });
        }
      }
    } catch (e) {
      console.warn('Video recording init failed:', e?.message ?? e);
    }

    const timerId = setInterval(() => {
      const currentDrone = dronesRef.current.find(d => d.id === droneId);
      if (!currentDrone || currentDrone.flightStatus !== flightStatus.FLYING) {
        clearInterval(timerId);
        activeTimersRef.current.delete(droneId);
        return;
      }

      const nowMs = Date.now();
      const elapsedTime = nowMs - startTime;

      if (elapsedTime >= missionParams.totalTime) {
        completeDroneFlight(droneId);
        return;
      }

      let accumulatedTime = 0;
      let currentSegment = 0;

      for (let i = 0; i < missionParams.segmentTimes.length; i++) {
        if (elapsedTime <= accumulatedTime + missionParams.segmentTimes[i]) {
          currentSegment = i;
          break;
        }
        accumulatedTime += missionParams.segmentTimes[i];
      }

      const segmentProgress = (elapsedTime - accumulatedTime) / missionParams.segmentTimes[currentSegment];
      const clampedProgress = Math.min(1, Math.max(0, segmentProgress));

      if (currentSegment === missionParams.segmentTimes.length - 1 && clampedProgress >= 0.99) {
        completeDroneFlight(droneId);
        return;
      }

      const pathForFlight = currentDrone.currentMission?.flightPath ?? currentDrone.path;
      const startPoint = pathForFlight[currentSegment];
      const endPoint = pathForFlight[currentSegment + 1];

      const currentLat = startPoint[0] + (endPoint[0] - startPoint[0]) * clampedProgress;
      const currentLng = startPoint[1] + (endPoint[1] - startPoint[1]) * clampedProgress;

      const segmentCount = pathForFlight.length - 1;

      const missionId = backendMissionIdsRef.current.get(droneId);
      const batteryDrain = (missionParams.batteryConsumption * elapsedTime) / missionParams.totalTime;
      const remainingBattery = Math.max(0, 100 - batteryDrain);

      const totalProgressForVideo = segmentCount > 0
        ? ((currentSegment + clampedProgress) / segmentCount) * 100
        : 100;

      if (videoCtx) {
        try {
          videoCtx.clearRect(0, 0, VIDEO_CANVAS_WIDTH, VIDEO_CANVAS_HEIGHT);
          videoCtx.fillStyle = 'black';
          videoCtx.fillRect(0, 0, VIDEO_CANVAS_WIDTH, VIDEO_CANVAS_HEIGHT);
          videoCtx.fillStyle = 'white';
          videoCtx.font = '16px Arial';
          videoCtx.fillText(`Drone: ${drone?.name ?? droneId}`, 20, 28);
          videoCtx.font = '13px Arial';
          videoCtx.fillText(`Coords: ${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`, 20, 52);
          videoCtx.fillText(`Battery: ${Math.round(remainingBattery)}%`, 20, 72);
          videoCtx.fillText(`Progress: ${totalProgressForVideo.toFixed(1)}%`, 20, 92);

          const barX = 20;
          const barY = 120;
          const barW = VIDEO_CANVAS_WIDTH - 40;
          const barH = 12;
          const pct = Math.min(1, Math.max(0, totalProgressForVideo / 100));
          videoCtx.fillStyle = 'rgba(255,255,255,0.25)';
          videoCtx.fillRect(barX, barY, barW, barH);
          videoCtx.fillStyle = 'rgba(34, 197, 94, 0.9)';
          videoCtx.fillRect(barX, barY, barW * pct, barH);
        } catch {}
      }

      const lastSentAt = telemetryLastSentAtRef.current.get(droneId) ?? 0;
      const sending = telemetrySendingRef.current.get(droneId) ?? false;
      const shouldSendTelemetry =
        missionId != null &&
        !sending &&
        nowMs - lastSentAt >= TELEMETRY_SEND_EVERY_MS;

      if (shouldSendTelemetry) {
        telemetrySendingRef.current.set(droneId, true);
        telemetryLastSentAtRef.current.set(droneId, nowMs);
        void postTelemetryToBackend({
          missionId,
          recordedAt: new Date().toISOString(),
          latitude: currentLat,
          longitude: currentLng,
          altitude: Math.round(currentDrone.altitude ?? 50),
          speed: Math.max(0, Number(missionParams.optimalSpeed ?? 0) / 3.6),
          battery: Math.round(remainingBattery),
        }).catch((e) => {
          console.warn('POST telemetry:', e?.message ?? e);
        }).finally(() => {
          telemetrySendingRef.current.set(droneId, false);
        });
      }

      setDrones(prev =>
        prev.map(d => {
          if (d.id !== droneId) return d;

          const totalProgress = segmentCount > 0
            ? ((currentSegment + clampedProgress) / segmentCount) * 100
            : 100;
          const batteryDrain = (missionParams.batteryConsumption * elapsedTime) / missionParams.totalTime;
          const remainingBattery = Math.max(0, 100 - batteryDrain);

          if (remainingBattery <= 1) {
            addToDroneLog(droneId, '🔋 Критически низкий заряд батареи! Аварийная посадка');
            completeDroneFlight(droneId);
            return d;
          }

          return {
            ...d,
            position: { lat: currentLat, lng: currentLng },
            currentWaypointIndex: currentSegment,
            flightProgress: totalProgress,
            battery: Math.round(remainingBattery),
            heading: calculateBearing(startPoint[0], startPoint[1], endPoint[0], endPoint[1]),
            missionElapsedTime: elapsedTime
          };
        })
      );

    }, 100);

    activeTimersRef.current.set(droneId, timerId);

    setDrones(prev =>
      prev.map(d => {
        if (d.id !== droneId) return d;
        return {
          ...d,
          missionTimerId: timerId
        };
      })
    );
  };

  const completeDroneFlight = (droneId) => {
    const timerId = activeTimersRef.current.get(droneId);
    if (timerId) {
      clearInterval(timerId);
      activeTimersRef.current.delete(droneId);
    }

    const drone = dronesRef.current.find(d => d.id === droneId);
    const isFlyToFirstOnly = drone?.currentMission?.flyToFirstOnly;

    if (isFlyToFirstOnly) {
      const flightPath = drone?.currentMission?.flightPath;
      const lastPoint = flightPath?.length ? flightPath[flightPath.length - 1] : null;
      setDrones(prev =>
        prev.map(d => {
          if (d.id !== droneId) return d;
          return {
            ...d,
            flightStatus: flightStatus.IDLE,
            isFlying: false,
            status: 'на земле',
            speed: 0,
            altitude: 100,
            position: lastPoint ? { lat: lastPoint[0], lng: lastPoint[1] } : d.position,
            currentWaypointIndex: 0,
            flightProgress: 0,
            missionTimerId: null,
            missionStartTime: null,
            missionElapsedTime: 0,
            currentMission: null
          };
        })
      );
      addToDroneLog(droneId, '📍 Дрон завис над первой точкой. Нажмите «Запустить миссию».');
      void stopVideoRecordingForDrone(droneId).catch(() => {});
      return;
    }

    setDrones(prev =>
      prev.map(d => {
        if (d.id !== droneId) return d;
        return {
          ...d,
          flightStatus: flightStatus.LANDING,
          speed: 5,
          altitude: 50
        };
      })
    );

    addToDroneLog(droneId, '🛬 Начинается посадка');

    setTimeout(async () => {
      setDrones(prev =>
        prev.map(d => {
          if (d.id !== droneId) return d;
          const path = d.currentMission?.flightPath;
          const lastPoint = path?.length ? path[path.length - 1] : null;
          return {
            ...d,
            flightStatus: flightStatus.COMPLETED,
            isFlying: false,
            status: 'на земле',
            speed: 0,
            altitude: 0,
            position: lastPoint ? { lat: lastPoint[0], lng: lastPoint[1] } : d.position,
            currentWaypointIndex: 0,
            flightProgress: 100,
            missionTimerId: null,
            missionStartTime: null,
            missionElapsedTime: 0,
            currentMission: {
              ...d.currentMission,
              endTime: new Date().toISOString(),
              completed: true
            }
          };
        })
      );

      addToDroneLog(droneId, '✅ Миссия завершена успешно');

      const missionIdForUpload = backendMissionIdsRef.current.get(droneId);
      const blob = await stopVideoRecordingForDrone(droneId);

      void syncDroneStateToBackend(droneId, { status: 'idle' }).catch((e) =>
        console.warn('PATCH drone (завершение):', e?.message ?? e)
      );

      await completeBackendMissionForDrone(droneId);
      if (missionIdForUpload && blob) {
        try {
          await uploadVideoMultipartForMission({
            missionId: missionIdForUpload,
            droneId,
            blob,
          });
        } catch (e) {
          console.warn('Video multipart upload failed:', e?.message ?? e);
        }
      }
    }, 3000);
  };

  const stopDroneFlight = (droneId) => {
    const timerId = activeTimersRef.current.get(droneId);
    if (timerId) {
      clearInterval(timerId);
      activeTimersRef.current.delete(droneId);
    }

    setDrones(prev =>
      prev.map(d => {
        if (d.id !== droneId) return d;
        return {
          ...d,
          flightStatus: flightStatus.IDLE,
          isFlying: false,
          status: 'на земле',
          speed: 0,
          altitude: 0,
          missionTimerId: null,
          missionStartTime: null,
          missionElapsedTime: 0,
          flightProgress: 0,
          currentWaypointIndex: 0
        };
      })
    );

    addToDroneLog(droneId, '⏹️ Полёт принудительно остановлен');
    void syncDroneStateToBackend(droneId, { status: 'idle' }).catch((e) =>
      console.warn('PATCH drone (стоп):', e?.message ?? e)
    );
    void cancelBackendMissionForDrone(droneId);

    void stopVideoRecordingForDrone(droneId).catch(() => {});
  };

  const pauseDroneFlight = (droneId) => {
    const timerId = activeTimersRef.current.get(droneId);
    if (timerId) {
      clearInterval(timerId);
      activeTimersRef.current.delete(droneId);
    }

    setDrones(prev =>
      prev.map(d => {
        if (d.id !== droneId) return d;
        return {
          ...d,
          flightStatus: flightStatus.PAUSED,
          missionTimerId: null
        };
      })
    );

    addToDroneLog(droneId, '⏸️ Полёт приостановлен');
  };

  const resumeDroneFlight = (droneId) => {
    const drone = drones.find(d => d.id === droneId);
    if (drone && drone.flightStatus === flightStatus.PAUSED) {
      setDrones(prev =>
        prev.map(d => {
          if (d.id !== droneId) return d;
          return {
            ...d,
            flightStatus: flightStatus.FLYING
          };
        })
      );

      startFlightMovement(droneId);
      addToDroneLog(droneId, '▶️ Полёт возобновлён');
    }
  };

  const getActiveFlights = () => {
    return drones.filter(d => d.flightStatus === flightStatus.FLYING || d.flightStatus === flightStatus.TAKEOFF);
  };

  const centerMapToFirstWaypoint = useCallback(() => {
    if (selectedDroneForSidebar == null) return;
    const drone = drones.find(d => d.id === selectedDroneForSidebar);
    if (!drone?.path?.length) return;
    const first = drone.path[0];
    setMapCenter([first[0], first[1]]);
  }, [drones, selectedDroneForSidebar]);

  const flyDroneToFirstWaypoint = useCallback((droneId) => {
    const drone = drones.find(d => d.id === droneId);
    if (!drone?.path?.length) {
      return;
    }
    if (drone.flightStatus === flightStatus.FLYING || drone.flightStatus === flightStatus.TAKEOFF || drone.flightStatus === flightStatus.LANDING) {
      return;
    }
    const firstWaypoint = drone.path[0];
    if (!drone.position) {
      setDrones(prev =>
        prev.map(d =>
          d.id !== droneId ? d : { ...d, position: { lat: firstWaypoint[0], lng: firstWaypoint[1] } }
        )
      );
      addToDroneLog(droneId, '📍 Дрон размещён на первой точке миссии');
      return;
    }
    const distToFirst = calculateDistance(
      drone.position.lat,
      drone.position.lng,
      firstWaypoint[0],
      firstWaypoint[1]
    );
    if (distToFirst <= FIRST_WAYPOINT_TRANSIT_THRESHOLD_M) {
      setDrones(prev =>
        prev.map(d =>
          d.id !== droneId ? d : { ...d, position: { lat: firstWaypoint[0], lng: firstWaypoint[1] } }
        )
      );
      addToDroneLog(droneId, '📍 Дрон уже у первой точки миссии');
      return;
    }
    const flightPath = [[drone.position.lat, drone.position.lng], [firstWaypoint[0], firstWaypoint[1]]];
    const missionParams = computeMissionParamsFromPath(flightPath, drone.maxSpeed, drone.battery);
    if (!missionParams || drone.battery < missionParams.batteryConsumption + 10) {
      return;
    }
    setDrones(prev =>
      prev.map(d => {
        if (d.id !== droneId) return d;
        return {
          ...d,
          flightStatus: flightStatus.TAKEOFF,
          isFlying: true,
          currentMission: {
            startTime: new Date().toISOString(),
            totalWaypoints: 1,
            totalDistance: missionParams.totalDistance,
            estimatedTime: missionParams.estimatedTime,
            missionParams,
            flightPath,
            flyToFirstOnly: true
          },
          currentWaypointIndex: 0,
          flightProgress: 0,
          speed: missionParams.optimalSpeed / 3.6,
          altitude: 50,
          heading: 0,
          missionParameters: missionParams,
          missionStartTime: Date.now(),
          missionElapsedTime: 0
        };
      })
    );
    addToDroneLog(droneId, '📍 Перелёт к первой точке миссии', {
      distance: `${Math.round(distToFirst)} м`
    });
    setTimeout(() => {
      setDrones(prev =>
        prev.map(d => {
          if (d.id !== droneId) return d;
          return { ...d, flightStatus: flightStatus.FLYING, altitude: 100 };
        })
      );
      addToDroneLog(droneId, '🛫 Взлёт выполнен');
      startFlightMovement(droneId);
    }, 2000);
  }, [drones]);

  const stopAllFlights = () => {
    drones.forEach(drone => {
      if (drone.isFlying) {
        stopDroneFlight(drone.id);
      }
    });
  };

  useEffect(() => {
    return () => {
      activeTimersRef.current.forEach(timerId => {
        clearInterval(timerId);
      });
      activeTimersRef.current.clear();
    };
  }, []);

  const handleStart = (templateId = null) => {
    setHasStarted(true);
    setTemplateToApplyId(templateId || null);
  };

  const handleLogout = useCallback(() => {
    clearApiSession();
    backendMissionIdsRef.current = new Map();
    backendContextRef.current = { userId: null, zoneId: null };
    activeTimersRef.current.forEach((id) => clearInterval(id));
    activeTimersRef.current.clear();
    setDrones(createLocalDrones());
    setBackendSync({ status: 'idle', message: '' });
    setHasStarted(false);
    setAuthReady(false);
    setSidebarOpen(false);
    setParkingOpen(false);
    setSelectedDroneForSidebar(null);
    setSelectedDroneForModal(null);
    setBackendZones([]);
    setActiveZoneId(null);
    setZoneFitNonce(0);
    setZoneKmlMessage(null);
    setZoneKmlIsError(false);
    setDrawRectZoneMode(false);
    setDraftRectBoundary(null);
    setRectZoneBusy(false);

    telemetryLastSentAtRef.current = new Map();
    telemetrySendingRef.current = new Map();

    videoRecordingByDroneRef.current = new Map();
    videoUploadInProgressRef.current = new Map();
  }, []);

  const toggleDrawRectZoneMode = useCallback(() => {
    setIsRouteEditMode(false);
    if (drawRectZoneMode) {
      setDrawRectZoneMode(false);
      return;
    }
    setEditingZoneId(null);
    setDraftRectBoundary(null);
    setNewRectZoneName('');
    setDraftRectZoneColor(activeZoneColor);
    setDrawRectZoneMode(true);
  }, [drawRectZoneMode, activeZoneColor]);

  const cancelDraftRectZone = useCallback(() => {
    setEditingZoneId(null);
    setDraftRectBoundary(null);
    setDrawRectZoneMode(false);
    setNewRectZoneName('');
    setDraftRectZoneColor(activeZoneColor);
  }, [activeZoneColor]);

  const handleDraftRectBoundaryChange = useCallback((nextBoundary) => {
    setDraftRectBoundary(nextBoundary ?? null);
  }, []);

  const handleDraftRectZoneColorChange = useCallback((e) => {
    const nextColor = e.target.value;
    if (!/^#[0-9a-fA-F]{6}$/.test(nextColor)) return;
    setDraftRectZoneColor(nextColor);
    setNewRectZoneName((prev) => {
      const updated = updateAutoZoneNameColor(prev, nextColor);
      return updated ?? prev;
    });
  }, []);

  const handleRectDrawComplete = useCallback(() => {
    setDrawRectZoneMode(false);
  }, []);

  const handleZoneClickToEdit = useCallback((boundary, zoneMeta) => {
    const targetZoneId = zoneMeta?.id ?? activeZoneId;
    if (targetZoneId == null) return;
    if (drawRectZoneMode || templateEditMode || placementMode || isRouteEditMode) return;
    if (!Array.isArray(boundary) || boundary.length < 4) return;
    const targetZone = backendZones.find((z) => z.id === targetZoneId);
    setActiveZoneId(targetZoneId);
    const u = backendContextRef.current.userId;
    if (u != null) {
      backendContextRef.current = { userId: u, zoneId: targetZoneId };
    }
    setEditingZoneId(targetZoneId);
    setNewRectZoneName(targetZone?.name ?? '');
    setDraftRectZoneColor(/^#[0-9a-fA-F]{6}$/.test(zoneColorsById[String(targetZoneId)]) ? zoneColorsById[String(targetZoneId)] : '#22c55e');
    setDraftRectBoundary(boundary.map(([lng, lat]) => [lng, lat]));
  }, [activeZoneId, backendZones, drawRectZoneMode, templateEditMode, placementMode, isRouteEditMode, zoneColorsById]);

  const saveDraftRectZone = useCallback(async () => {
    if (!draftRectBoundary?.length) return;
    let targetEditingZoneId = editingZoneId;
    if (templateEditMode === 'create' && targetEditingZoneId == null && templateDraftZoneId != null) {
      window.alert(
        'Для этого шаблона зона уже создана. Можно редактировать текущую зону, но нельзя создать вторую.'
      );
      return;
    }
    setRectZoneBusy(true);
    try {
      if (targetEditingZoneId != null) {
        const currentZoneName =
          backendZones.find((z) => String(z?.id) === String(targetEditingZoneId))?.name ?? '';
        const nextName = newRectZoneName.trim() || currentZoneName || `Зона №${targetEditingZoneId}("${zoneColorNameFromHex(draftRectZoneColor)}")`;
        const duplicate = backendZones.some(
          (z) =>
            String(z?.id) !== String(targetEditingZoneId) &&
            normalizeZoneName(z?.name) === normalizeZoneName(nextName)
        );
        if (duplicate) {
          window.alert(`Зона с именем «${nextName}» уже существует. Укажите другое название.`);
          return;
        }
        await updateZoneWithBoundary(targetEditingZoneId, draftRectBoundary, nextName, draftRectZoneColor);
        const zones = await fetchZonesFromBackend();
        setBackendZones(zones);
        const updatedZone = zones.find((z) => z.id === targetEditingZoneId);
        addToZoneLog('🛠️ Граница зоны изменена', {
          zoneId: targetEditingZoneId,
          zoneName: updatedZone?.name ?? `ID ${targetEditingZoneId}`,
        });
        setZoneColorsById((prev) => ({ ...prev, [String(targetEditingZoneId)]: draftRectZoneColor }));
        setActiveZoneId(targetEditingZoneId);
        if (templateEditMode === 'create') setTemplateDraftZoneId(targetEditingZoneId);
        setEditingZoneId(null);
        setDraftRectBoundary(null);
        setNewRectZoneName(updatedZone?.name ?? nextName);
        return;
      }

      const rawName = newRectZoneName.trim();
      const existingNames = new Set(backendZones.map((z) => normalizeZoneName(z?.name)));
      if (rawName && existingNames.has(normalizeZoneName(rawName))) {
        window.alert(`Зона с именем «${rawName}» уже существует. Укажите другое название.`);
        return;
      }
      const name = rawName || buildAutoZoneName(backendZones, draftRectZoneColor);
      const created = await createZoneWithBoundary({ name, boundary: draftRectBoundary, color: draftRectZoneColor });
      const zones = await fetchZonesFromBackend();
      setBackendZones(zones);
      const newId = created?.id;
      if (newId != null) {
        setZoneColorsById((prev) => ({ ...prev, [String(newId)]: draftRectZoneColor }));
        setActiveZoneId(newId);
        if (templateEditMode === 'create') setTemplateDraftZoneId(newId);
        const u = backendContextRef.current.userId;
        if (u != null) {
          backendContextRef.current = { userId: u, zoneId: newId };
        }
        addToZoneLog('🆕 Создана новая зона', {
          zoneId: newId,
          zoneName: created?.name ?? name,
        });
      }
      setEditingZoneId(null);
      setDraftRectBoundary(null);
    } catch (err) {
      setZoneKmlMessage(String(err?.message ?? err));
      setZoneKmlIsError(true);
    } finally {
      setRectZoneBusy(false);
    }
  }, [draftRectBoundary, newRectZoneName, editingZoneId, addToZoneLog, templateEditMode, templateDraftZoneId, backendZones, activeZoneId, draftRectZoneColor]);

  const handleDeleteActiveZone = useCallback(async () => {
    if (activeZoneId == null) return;
    const usageCount = Number(templateUsageByZoneId[String(activeZoneId)] || 0);
    if (usageCount > 0) {
      const zoneName = backendZones.find((z) => z.id === activeZoneId)?.name ?? `ID ${activeZoneId}`;
      addToZoneLog('⛔ Нельзя удалить зону: она используется в шаблонах', {
        zoneId: activeZoneId,
        zoneName,
        templates: usageCount,
      });
      window.alert(
        `Нельзя удалить зону «${zoneName}»: она используется в ${usageCount} шаблон(ах).\nУдаляйте/переносите шаблоны только в меню шаблонов.`
      );
      return;
    }
    const targetZone = backendZones.find((z) => z.id === activeZoneId);
    const title = targetZone?.name ? `«${targetZone.name}»` : `ID ${activeZoneId}`;
    const confirmed = window.confirm(`Удалить зону ${title}? Это действие нельзя отменить.`);
    if (!confirmed) return;

    setRectZoneBusy(true);
    try {
      await deleteZoneInBackend(activeZoneId);
      const zones = await fetchZonesFromBackend();
      setBackendZones(zones);
      addToZoneLog('🗑️ Зона удалена', {
        zoneId: activeZoneId,
        zoneName: targetZone?.name ?? `ID ${activeZoneId}`,
      });

      const nextActiveZoneId = zones.length > 0 ? zones[0].id : null;
      setActiveZoneId(nextActiveZoneId);
      const userId = backendContextRef.current.userId ?? null;
      backendContextRef.current = { userId, zoneId: nextActiveZoneId };

      setEditingZoneId(null);
      setDrawRectZoneMode(false);
      setDraftRectBoundary(null);
    } catch (err) {
      setZoneKmlMessage(String(err?.message ?? err));
      setZoneKmlIsError(true);
    } finally {
      setRectZoneBusy(false);
    }
  }, [activeZoneId, backendZones, addToZoneLog, templateUsageByZoneId]);

  const handleDeleteTemplateFromMenu = useCallback(async (templateId, mode = 'route_only') => {
    const template = missionTemplates.find((t) => t.id === templateId);
    if (!template) return;
    const resolveTemplateZoneId = (tpl) =>
      tpl?.zoneId ?? inferZoneIdForTemplatePath(tpl?.path, backendZones);
    const templateZoneId = resolveTemplateZoneId(template);
    const sameZoneTemplateIds = collectSameZoneTemplateIds(templateId, missionTemplates, backendZones);
    const otherCount = Math.max(0, sameZoneTemplateIds.length - 1);

    if (mode === 'route_and_zone' && otherCount > 0) {
      const cascadeOk = window.confirm(
        `ВНИМАНИЕ: вместе с выбранным шаблоном будут удалены ещё ${otherCount} шаблон(а/ов), так как они находятся в той же зоне.\nПродолжить?`
      );
      if (!cascadeOk) return;
    }

    if (mode === 'route_and_zone' && templateZoneId != null) {
      const zoneId = templateZoneId;
      const zone = backendZones.find((z) => String(z.id) === String(zoneId));
      const zoneTitle = zone?.name ? `«${zone.name}»` : `ID ${zoneId}`;
      const ok = window.confirm(
        otherCount > 0
          ? `Удалить шаблон «${template.name || 'Без названия'}», связанную зону ${zoneTitle} и ещё ${otherCount} шаблон(а/ов) этой зоны?\nЭто действие нельзя отменить.`
          : `Удалить шаблон «${template.name || 'Без названия'}» и связанную зону ${zoneTitle}?\nЭто действие нельзя отменить.`
      );
      if (!ok) return;
      try {
        await deleteZoneInBackend(zoneId);
        const zones = await fetchZonesFromBackend();
        setBackendZones(zones);
        const nextActiveZoneId = zones.length > 0 ? zones[0].id : null;
        setActiveZoneId(nextActiveZoneId);
        const userId = backendContextRef.current.userId ?? null;
        backendContextRef.current = { userId, zoneId: nextActiveZoneId };
      } catch (err) {
        setZoneKmlMessage(String(err?.message ?? err));
        setZoneKmlIsError(true);
        return;
      }
    } else {
      const ok = window.confirm(
        `Удалить только шаблон «${template.name || 'Без названия'}»?\nМаршрут будет удалён из шаблонов, зоны останутся.`
      );
      if (!ok) return;
    }

    const idsToDelete =
      mode === 'route_and_zone' && otherCount > 0
        ? sameZoneTemplateIds
        : [templateId];
    try {
      await Promise.all(idsToDelete.map((id) => deleteRouteTemplateInBackend(id)));
      await reloadMissionTemplates();
    } catch (err) {
      setZoneKmlMessage(String(err?.message ?? err));
      setZoneKmlIsError(true);
    }
  }, [missionTemplates, backendZones, reloadMissionTemplates]);

  const templateCascadeCountById = useMemo(() => {
    const map = {};
    for (const t of missionTemplates) {
      const ids = collectSameZoneTemplateIds(t.id, missionTemplates, backendZones);
      const cnt = Math.max(0, ids.length - 1);
      if (cnt > 0) map[t.id] = cnt;
    }
    return map;
  }, [missionTemplates, backendZones]);

  const templateCascadeMetaById = useMemo(() => {
    const out = {};
    const resolveTemplateZoneId = (tpl) =>
      tpl?.zoneId ?? inferZoneIdForTemplatePath(tpl?.path, backendZones);
    for (const t of missionTemplates) {
      const ids = collectSameZoneTemplateIds(t.id, missionTemplates, backendZones);
      const related = missionTemplates.filter((x) => ids.includes(x.id) && x.id !== t.id);
      if (!related.length) continue;
      const zoneId = resolveTemplateZoneId(t);
      const zone = zoneId == null ? null : backendZones.find((z) => String(z.id) === String(zoneId));
      out[t.id] = {
        zoneId: zoneId ?? null,
        zoneName: zone?.name ?? (zoneId != null ? `ID ${zoneId}` : 'не определена'),
        relatedTemplateNames: related.map((x) => x.name || `Шаблон ${x.id}`),
      };
    }
    return out;
  }, [missionTemplates, backendZones]);

  const pendingKmlActionRef = useRef('create');

  const applyActiveZoneId = useCallback((id) => {
    const n = Number(id);
    if (!Number.isFinite(n)) return;
    setActiveZoneId(n);
    setZoneFitNonce((x) => x + 1);
    const u = backendContextRef.current.userId;
    if (u != null) {
      backendContextRef.current = { userId: u, zoneId: n };
    }
  }, []);

  const handleActiveZoneColorChange = useCallback((e) => {
    const nextColor = e.target.value;
    if (activeZoneId == null || !/^#[0-9a-fA-F]{6}$/.test(nextColor)) return;
    setZoneColorsById((prev) => ({ ...prev, [String(activeZoneId)]: nextColor }));
    if (editingZoneId != null && String(editingZoneId) === String(activeZoneId)) {
      setNewRectZoneName((prev) => {
        const fromInput = updateAutoZoneNameColor(prev, nextColor);
        if (fromInput) return fromInput;
        const currentZoneName =
          backendZones.find((z) => String(z?.id) === String(activeZoneId))?.name ?? '';
        const fromZoneName = updateAutoZoneNameColor(currentZoneName, nextColor);
        return fromZoneName ?? prev;
      });
    }
  }, [activeZoneId, editingZoneId, backendZones]);

  const openKmlPicker = useCallback((action) => {
    pendingKmlActionRef.current = action;
    zoneKmlInputRef.current?.click();
  }, []);

  const handleZoneKmlFile = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const action = pendingKmlActionRef.current;
      setZoneKmlBusy(true);
      setZoneKmlMessage(null);
      setZoneKmlIsError(false);
      try {
        if (action === 'create') {
          const candidate = newZoneKmlName.trim();
          const baseName = candidate || buildAutoZoneName(backendZones, draftRectZoneColor);
          const duplicate = backendZones.some((z) => normalizeZoneName(z?.name) === normalizeZoneName(baseName));
          if (duplicate) {
            throw new Error(`Зона с именем «${baseName}» уже существует. Укажите другое название.`);
          }
          const created = await createZoneWithKml({
            name: baseName,
            description: '',
            file,
            color: draftRectZoneColor,
          });
          const zones = await fetchZonesFromBackend();
          setBackendZones(zones);
          const newId = created?.id;
          if (newId != null) {
            setActiveZoneId(newId);
            const u = backendContextRef.current.userId;
            if (u != null) {
              backendContextRef.current = { userId: u, zoneId: newId };
            }
            setZoneFitNonce((n) => n + 1);
            addToZoneLog('🆕 Зона создана из KML', {
              zoneId: newId,
              zoneName: created?.name ?? baseName,
              fileName: file.name,
            });
          }
          setZoneKmlMessage(`Зона «${created?.name ?? baseName}» создана.`);
          setZoneKmlIsError(false);
        } else {
          if (activeZoneId == null) {
            throw new Error('Сначала выберите зону в списке');
          }
          await updateZoneWithKml(activeZoneId, file);
          const zones = await fetchZonesFromBackend();
          setBackendZones(zones);
          setZoneFitNonce((n) => n + 1);
          const updatedZone = zones.find((z) => z.id === activeZoneId);
          addToZoneLog('🛠️ Контур зоны обновлён из KML', {
            zoneId: activeZoneId,
            zoneName: updatedZone?.name ?? `ID ${activeZoneId}`,
            fileName: file.name,
          });
          setZoneKmlMessage('Контур выбранной зоны обновлён из KML.');
          setZoneKmlIsError(false);
        }
      } catch (err) {
        setZoneKmlMessage(String(err?.message ?? err));
        setZoneKmlIsError(true);
      } finally {
        setZoneKmlBusy(false);
      }
    },
    [activeZoneId, newZoneKmlName, addToZoneLog, backendZones, draftRectZoneColor]
  );

  const handleWorkspaceTourOpenChange = useCallback((open) => {
    setWorkspaceTourOpen(open);
    if (!open) setWorkspaceOnboardingStepId(null);
  }, []);

  const handleOnboardingBeforeStep = useCallback(
    (stepId) => {
      setWorkspaceOnboardingStepId(stepId ?? null);
      setSidebarOpen(true);
      if (stepId === 'place-drone') {
        setParkingOpen(true);
      } else {
        setParkingOpen(false);
      }
    },
    []
  );

  const handleDroneClick = (drone) => {
    setSelectedDroneForModal(drone);
  };

  if (!authReady) {
    return (
      <AuthScreen
        onLoggedIn={() => {
          resetWorkspaceOnboardingForLogin();
          setAuthReady(true);
        }}
      />
    );
  }
  const workspaceVisible = hasStarted && !exitingToTemplates;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-transparent text-white px-2 sm:px-3 py-2 sm:py-3">
      {(sidebarOpen || parkingOpen) && (
        <button
          type="button"
          aria-label="Закрыть"
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => { setSidebarOpen(false); setParkingOpen(false); }}
        />
      )}
      {authUserLabel && (
        <div className="fixed top-2 right-2 sm:top-3 sm:right-3 z-[1200]">
          <div className="w-[300px] rounded-2xl border border-[rgba(0,188,125,0.4)] bg-emerald-900/30 px-3 py-2 text-sm text-emerald-100 shadow-lg shadow-emerald-900/20 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-emerald-400/60 bg-emerald-950/70 text-2xl leading-none">
                  👤
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="text-[11px] uppercase tracking-wide text-emerald-300/90">Статус аккаунта</p>
                  <p className="truncate">
                    Вы вошли: <strong>{authUserLabel}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/60 bg-red-900/30 px-3 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-800/50 hover:text-white"
              >
                <span className="text-base leading-none">↩</span>
                <span>Выход</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 gap-2 lg:gap-3 min-h-0 overflow-hidden flex-col lg:flex-row">
        <div
          className={`fixed left-0 top-0 bottom-0 z-50 w-[85%] max-w-sm transform transition-transform duration-300 ease-out lg:relative lg:w-72 lg:max-w-none lg:flex-shrink-0 ${
            workspaceVisible
              ? `${parkingOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} opacity-100`
              : 'pointer-events-none translate-x-[100vw] opacity-0'
          }`}
          style={{
            transitionDuration: `${VIEW_TRANSITION_MS}ms`,
            transitionTimingFunction: DESKTOP_SWITCH_EASE,
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <DroneParking
            drones={drones}
            onPlaceDrone={startDronePlacement}
            onRemoveDrone={removeDroneFromMap}
            onCreateDrone={createDroneFromParking}
            onBackToTemplates={() => {
              setExitingToTemplates(true);
              setParkingOpen(false);
              setTimeout(() => {
                setHasStarted(false);
                setExitingToTemplates(false);
              }, EXIT_PANELS_MS);
            }}
            onClose={() => setParkingOpen(false)}
          />
        </div>
        <main className="flex-1 bg-transparent p-2 sm:p-3 rounded flex flex-col min-w-0 min-h-0">
          {templateEditMode ? (
            <div className="flex-1 flex flex-col min-h-0 relative">
              <div className="flex-1 min-h-0">
                <YandexMap
                  drones={[]}
                  mapCenter={mapCenter}
                  mapZoom={mapZoom}
                  onMapClick={handleMapClick}
                  onZoneClick={drawRectZoneMode || draftRectBoundary ? handleZoneClickToEdit : undefined}
                  onDraftRectBoundaryChange={handleDraftRectBoundaryChange}
                  onRectDrawComplete={handleRectDrawComplete}
                  editingPath={null}
                  routeEditMode={!drawRectZoneMode && !draftRectBoundary}
                  routeEditPath={templateDraftPath}
                  onRoutePathChange={handleTemplateRoutePathChange}
                  forceResize={false}
                  zones={zonesForMap}
                  zoneBoundary={activeZoneBoundary}
                  zoneColor={activeZoneColor}
                  zoneFitNonce={zoneFitNonce}
                  draftRectBoundary={draftRectBoundary}
                  drawRectZoneMode={drawRectZoneMode}
                />
              </div>
              {(drawRectZoneMode || draftRectBoundary) && (
                <div className="absolute top-2 left-2 z-[130] w-[min(82vw,340px)] rounded-xl border border-amber-600/40 bg-gray-900/80 p-2 backdrop-blur-sm">
                  {drawRectZoneMode && !draftRectBoundary && (
                    <p className="text-xs text-amber-200">
                      Зажмите кнопку мыши на карте, потяните и отпустите, чтобы нарисовать прямоугольник.
                    </p>
                  )}
                  {draftRectBoundary && (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-col gap-2 items-stretch">
                        <input
                          type="text"
                          value={newRectZoneName}
                          onChange={(e) => setNewRectZoneName(e.target.value)}
                          placeholder="Имя зоны"
                          className="px-3 py-2 bg-gray-800 border border-amber-700/60 rounded-lg text-white text-sm min-h-[42px] w-full"
                        />
                        <label className="relative w-full px-3 py-2 min-h-[42px] bg-gray-800 border border-gray-500/70 rounded-lg text-white text-sm flex items-center justify-end">
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center whitespace-nowrap">
                            Цвет зоны
                          </span>
                          <input
                            type="color"
                            value={draftRectZoneColor}
                            onChange={handleDraftRectZoneColorChange}
                            className="h-7 w-10 p-0 border-0 rounded cursor-pointer bg-transparent"
                            title="Выбрать цвет зоны"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={saveDraftRectZone}
                          disabled={rectZoneBusy || zoneKmlBusy}
                          className="w-full px-3 py-2 min-h-[42px] bg-transparent border border-gray-500/70 text-gray-100 hover:bg-emerald-700/80 hover:text-white disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                        >
                          {editingZoneId != null ? 'Сохранить изменения' : 'Сохранить зону'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelDraftRectZone}
                          disabled={rectZoneBusy}
                          className="w-full px-3 py-2 min-h-[42px] bg-transparent border border-gray-500/70 text-gray-200 hover:bg-black/80 hover:text-white disabled:opacity-50 rounded-lg text-sm transition-colors"
                        >
                          Отмена редактирования
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="pointer-events-none absolute bottom-4 left-0 right-4 z-[100] flex flex-col items-start gap-2">
                <div className="pointer-events-auto w-full max-w-md bg-gray-800/95 border border-gray-600 rounded-xl p-4 shadow-xl">
                <h3 className="font-semibold text-white mb-2">
                  {templateEditMode === 'create' ? 'Создание шаблона маршрута' : 'Редактирование маршрута'}
                </h3>
                <p className="text-gray-400 text-sm mb-3">
                  Кликайте по карте, чтобы добавить точки маршрута патрулирования.
                </p>
                <p className="text-gray-400 text-xs mb-3">
                  Режим как в рабочей зоне: можно тянуть узлы и сегменты, маршрут строится внутри активной зоны.
                </p>
                <p className="text-white/80 text-sm mb-3">Точек: <strong>{templateDraftPath.length}</strong></p>
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    type="button"
                    onClick={undoTemplateDraftPoint}
                    disabled={!templateDraftPath.length}
                    className="px-3 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium"
                  >
                    Отменить последнюю
                  </button>
                  <button
                    type="button"
                    onClick={toggleDrawRectZoneMode}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      drawRectZoneMode
                        ? 'bg-amber-900 hover:bg-amber-800 text-amber-100 border border-amber-500/70'
                        : 'bg-amber-700 hover:bg-amber-600 text-white border border-amber-500/60'
                    }`}
                    title={drawRectZoneMode ? 'Отменить создание зоны' : 'Создать зону'}
                  >
                    {drawRectZoneMode ? 'Отменить создание зоны' : 'Создать зону'}
                  </button>
                </div>
                <div className="mb-3">
                  <label className="block text-sm text-gray-400 mb-1">Название шаблона</label>
                  <input
                    type="text"
                    value={templateDraftName}
                    onChange={(e) => setTemplateDraftName(e.target.value)}
                    placeholder="Например: Облёт периметра"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveTemplateDraft}
                    disabled={templateDraftPath.length < 2}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium"
                  >
                    Сохранить шаблон
                  </button>
                  <button
                    type="button"
                    onClick={cancelTemplateEdit}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium"
                  >
                    Отмена
                  </button>
                </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 relative min-h-0 overflow-visible">
              <div
                className={`absolute inset-0 flex items-center justify-center transition-transform will-change-transform ${
                  workspaceVisible
                    ? 'pointer-events-none -translate-x-[100vw]'
                    : 'translate-x-0'
                }`}
                style={{
                  transitionDuration: noTransitionTemplateSwitch ? '0ms' : `${VIEW_TRANSITION_MS}ms`,
                  transitionTimingFunction: DESKTOP_SWITCH_EASE,
                }}
              >
                <ShabloneScreen
                  onStart={handleStart}
                  templates={missionTemplates}
                  onStartCreateTemplate={startCreateTemplate}
                  onEditTemplateRoute={startEditTemplateRoute}
                  onDeleteTemplate={handleDeleteTemplateFromMenu}
                  templateCascadeCountById={templateCascadeCountById}
                  templateCascadeMetaById={templateCascadeMetaById}
                />
              </div>
              <div
                className={`absolute inset-0 flex flex-col min-h-0 transition-transform will-change-transform ${
                  workspaceVisible
                    ? 'translate-x-0'
                    : 'pointer-events-none translate-x-[100vw]'
                }`}
                style={{
                  transitionDuration: noTransitionTemplateSwitch ? '0ms' : `${VIEW_TRANSITION_MS}ms`,
                  transitionTimingFunction: DESKTOP_SWITCH_EASE,
                }}
              >
            <div className="w-full flex flex-col gap-2 flex-1 min-h-0">
              <div className="flex flex-col gap-2 mb-2 relative z-[1100]">
                <div className="flex flex-col lg:flex-row gap-2 lg:items-start">
                  <div className="flex-1 min-w-0">
                    <SearchBox
                      setMapCenter={setMapCenter}
                      setMapZoom={setMapZoom}
                    />
                  </div>
                </div>
              </div>
              <div className="flex-1 relative min-h-0">
                {(drawRectZoneMode || draftRectBoundary) && (
                  <div className="absolute top-2 left-2 z-[130] w-[min(82vw,340px)] rounded-xl border border-amber-600/40 bg-gray-900/80 p-2 backdrop-blur-sm">
                    {drawRectZoneMode && !draftRectBoundary && (
                      <p className="text-xs text-amber-200">
                        Зажмите кнопку мыши на карте, потяните и отпустите, чтобы нарисовать прямоугольник.
                      </p>
                    )}
                    {draftRectBoundary && (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col gap-2 items-stretch">
                          <input
                            type="text"
                            value={newRectZoneName}
                            onChange={(e) => setNewRectZoneName(e.target.value)}
                            placeholder="Имя зоны"
                            className="px-3 py-2 bg-gray-800 border border-amber-700/60 rounded-lg text-white text-sm min-h-[42px] w-full"
                          />
                          <label className="relative w-full px-3 py-2 min-h-[42px] bg-gray-800 border border-gray-500/70 rounded-lg text-white text-sm flex items-center justify-end">
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center whitespace-nowrap">
                              Цвет зоны
                            </span>
                            <input
                              type="color"
                              value={draftRectZoneColor}
                              onChange={handleDraftRectZoneColorChange}
                              className="h-7 w-10 p-0 border-0 rounded cursor-pointer bg-transparent"
                              title="Выбрать цвет зоны"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={saveDraftRectZone}
                            disabled={rectZoneBusy || zoneKmlBusy}
                            className="w-full px-3 py-2 min-h-[42px] bg-transparent border border-gray-500/70 text-gray-100 hover:bg-emerald-700/80 hover:text-white disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                          >
                            {editingZoneId != null ? 'Сохранить изменения' : 'Сохранить зону'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelDraftRectZone}
                            disabled={rectZoneBusy}
                            className="w-full px-3 py-2 min-h-[42px] bg-transparent border border-gray-500/70 text-gray-200 hover:bg-black/80 hover:text-white disabled:opacity-50 rounded-lg text-sm transition-colors"
                          >
                            Отмена редактирования
                          </button>
                          {editingZoneId != null && (
                            <button
                              type="button"
                              onClick={handleDeleteActiveZone}
                            disabled={
                              activeZoneId == null ||
                              rectZoneBusy ||
                              zoneKmlBusy ||
                              Number(templateUsageByZoneId[String(activeZoneId)] || 0) > 0
                            }
                            title={
                              Number(templateUsageByZoneId[String(activeZoneId)] || 0) > 0
                                ? 'Зона используется в шаблонах'
                                : 'Удалить активную зону'
                            }
                              className="w-full px-3 py-2 min-h-[42px] bg-transparent border border-gray-500/70 text-gray-100 hover:bg-red-900/80 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
                            >
                            {Number(templateUsageByZoneId[String(activeZoneId)] || 0) > 0
                              ? 'Зона в шаблонах'
                              : 'Удалить зону'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="absolute top-2 right-2 z-[100] flex justify-end">
                  <div className="relative flex flex-col items-end gap-2">
                    <WeatherWidget
                      latitude={mapCenter[0]}
                      longitude={mapCenter[1]}
                      onFlightConditionsChange={handleWeatherFlightConditions}
                    />
                    <button
                      type="button"
                      data-onboarding="zone-draw"
                      onClick={toggleDrawRectZoneMode}
                      title={drawRectZoneMode ? 'Отменить создание зоны' : 'Создать зону'}
                      aria-label={drawRectZoneMode ? 'Отменить создание зоны' : 'Создать зону'}
                      className={`w-11 h-11 rounded-lg text-white text-xl leading-none flex items-center justify-center border ${
                        drawRectZoneMode
                          ? 'bg-amber-900 border-amber-500 ring-2 ring-amber-400/70'
                          : 'bg-amber-950/90 border-amber-800 hover:bg-amber-900'
                      }`}
                    >
                      {drawRectZoneMode ? '×' : '▭'}
                    </button>
                  </div>
                </div>
                <YandexMap
                  drones={drones}
                  mapCenter={mapCenter}
                  mapZoom={mapZoom}
                  onMapClick={handleMapClick}
                  onZoneClick={handleZoneClickToEdit}
                  onDraftRectBoundaryChange={handleDraftRectBoundaryChange}
                  onRectDrawComplete={handleRectDrawComplete}
                  onMapCenterChange={setMapCenter}
                  onMapZoomChange={setMapZoom}
                  onDronePositionChange={handleDronePositionChange}
                  selectedDroneId={selectedDroneForSidebar}
                  forceResize={true}
                  routeEditMode={isRouteEditMode}
                  routeEditPath={selectedRouteEditPath}
                  onRoutePathChange={handleRoutePathChange}
                  routeShiftSegmentIndices={selectedRouteShiftSegments}
                  onRouteShiftSegmentToggle={toggleRouteShiftSegment}
                  workspaceOnboardingStepId={workspaceOnboardingStepId}
                  previewPath={templateToApplyId ? (missionTemplates.find(t => t.id === templateToApplyId)?.path) ?? null : null}
                  zones={zonesForMap}
                  zoneBoundary={activeZoneBoundary}
                  zoneColor={activeZoneColor}
                  zoneFitNonce={zoneFitNonce}
                  draftRectBoundary={draftRectBoundary}
                  drawRectZoneMode={drawRectZoneMode}
                  placementMode={placementMode && droneToPlace != null}
                />
                <ZoneMapMenu
                  zones={backendZones}
                  activeZoneId={activeZoneId}
                  onSelectZone={applyActiveZoneId}
                  showEmptyMenuDuringTour={workspaceTourOpen && backendZones.length === 0}
                />
                {placementMode && droneToPlace && (
                  <div
                    className="pointer-events-auto absolute bottom-3 left-1/2 z-[200] w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border border-yellow-500/70 bg-yellow-950/90 px-3 py-2.5 shadow-xl backdrop-blur-sm sm:bottom-4"
                    style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0px))' }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-yellow-100 leading-snug">
                        Кликните внутри контура активной зоны на карте, чтобы поставить дрон
                        {(() => {
                          const d = drones.find((x) => x.id === droneToPlace);
                          return d ? ` «${d.name}»` : '';
                        })()}
                      </p>
                      <button
                        type="button"
                        onClick={cancelDronePlacement}
                        className="shrink-0 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 min-h-[40px]"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div
                className="flex-shrink-0 flex justify-between items-center gap-2 lg:hidden pt-2"
                style={{ paddingBottom: 'env(safe-area-inset-bottom, 0.5rem)' }}
              >
                <button
                  type="button"
                  onClick={() => { setParkingOpen(true); setSidebarOpen(false); }}
                  className="min-h-[48px] flex-1 min-w-0 px-3 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-xl shadow-lg text-white font-medium flex items-center justify-center gap-1.5"
                >
                  <span>🛸</span>
                  <span>Стоянка</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExitingToTemplates(true);
                    setParkingOpen(false);
                    setSidebarOpen(false);
                    setTimeout(() => {
                      setHasStarted(false);
                      setExitingToTemplates(false);
                    }, EXIT_PANELS_MS);
                  }}
                  className="min-h-[48px] flex-1 min-w-0 px-3 py-3 bg-amber-600 hover:bg-amber-500 rounded-xl shadow-lg text-white font-medium flex items-center justify-center gap-1.5"
                >
                  <span>←</span>
                  <span className="truncate">Назад</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setSidebarOpen(true); setParkingOpen(false); }}
                  className="min-h-[48px] flex-1 min-w-0 px-3 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg text-white font-medium flex items-center justify-center gap-1.5"
                >
                  <span>⚙️</span>
                  <span>Панель</span>
                </button>
              </div>
            </div>
              </div>
            </div>
          )}
        </main>

        <div
          className={`fixed right-0 top-0 bottom-0 z-50 transform transition-transform duration-300 ease-out lg:relative lg:flex-shrink-0 ${
            workspaceTourOpen && sidebarOpen
              ? 'w-[min(calc(100vw-12px),28rem)] max-w-none lg:w-80 lg:max-w-none'
              : 'w-[85%] max-w-sm lg:w-80 lg:max-w-none'
          } ${
            workspaceVisible
              ? `${sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'} opacity-100`
              : 'pointer-events-none translate-x-[100vw] opacity-0'
          }`}
          style={{
            transitionDuration: `${VIEW_TRANSITION_MS}ms`,
            transitionTimingFunction: DESKTOP_SWITCH_EASE,
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <div className="flex h-full min-h-0 flex-col pt-[72px]">
            <div className="min-h-0 flex-1">
              <Sidebar
                dronesData={drones}
                selectedDroneId={selectedDroneForSidebar}
                onSelectDrone={setSelectedDroneForSidebar}
                missionLog={globalMissionLog}
                activeFlights={getActiveFlights()}
                onStartFlight={startDroneFlight}
                onPauseFlight={pauseDroneFlight}
                onResumeFlight={resumeDroneFlight}
                onStopFlight={stopDroneFlight}
                onStopAllFlights={stopAllFlights}
                onAddRoutePoint={addRoutePoint}
                onUndoLastPoint={undoLastPoint}
                onClearRoute={clearRoute}
                onClearLogs={() => setGlobalMissionLog([])}
                onDroneClick={handleDroneClick}
                isRouteEditMode={isRouteEditMode}
                onToggleRouteMode={handleToggleRouteMode}
                onCenterToFirstWaypoint={centerMapToFirstWaypoint}
                onFlyToFirstWaypoint={flyDroneToFirstWaypoint}
                flightAllowedByWeather={weatherFlightSafe}
                weatherFlightReasons={weatherFlightReasons}
                isDroneAtMissionStart={isDroneAtMissionStart}
                workZoneReady={workZoneReady}
                instructionTourActive={workspaceTourOpen}
                onClose={() => setSidebarOpen(false)}
              />
            </div>
          </div>
        </div>
      </div>

      {selectedDroneForModal && (
        <DroneModal
          drone={selectedDroneForModal}
          onClose={() => setSelectedDroneForModal(null)}
        />
      )}

      {workspaceVisible && hasStarted && !templateEditMode && (
        <WorkspaceOnboarding
          enabled
          onBeforeStep={handleOnboardingBeforeStep}
          onTourOpenChange={handleWorkspaceTourOpenChange}
          layoutKey={`${sidebarOpen}-${parkingOpen}-${workspaceTourOpen}`}
        />
      )}

      {false && hasStarted && (
        <footer
          className={`mt-2 bg-gradient-to-r from-gray-700 to-gray-800 p-3 rounded text-center text-white transition-all ease-in-out ${
            exitingToTemplates ? 'opacity-0 pointer-events-none translate-y-2' : 'opacity-100 translate-y-0'
          }`}
          style={{ transitionDuration: exitingToTemplates ? `${EXIT_PANELS_MS}ms` : `${VIEW_TRANSITION_MS}ms` }}
        >
          <div className="md:flex-row justify-between items-center">
            <div>
              © 2026 Система управления дронами.
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

export default App;