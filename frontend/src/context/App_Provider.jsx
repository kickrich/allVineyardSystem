import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { initialMapCenter, flightStatus } from '../constants/drones_data';
import { AppContext } from './App_Context';
import { resetTemplatesOnboardingForLogin, resetWorkspaceOnboardingForLogin } from '../constants/onboarding';
import {
  FIRST_WAYPOINT_TRANSIT_THRESHOLD_M,
  ROUTE_ZONE_REJECT_LOG_COOLDOWN_MS,
  TEMPLATE_ROUTE_REJECT_COOLDOWN_MS,
  TELEMETRY_SEND_EVERY_MS,
  ZONE_COLORS_STORAGE_KEY,
  VIDEO_CANVAS_WIDTH,
  VIDEO_CANVAS_HEIGHT,
  VIDEO_RECORDING_FPS,
  VIDEO_BACKEND_CONTENT_TYPE,
  VIDEO_RECORDER_MIME_CANDIDATES,
  VIDEO_MULTIPART_CHUNK_SIZE_BYTES,
  AI_RESULTS_POLL_INTERVAL_MS,
  MAP_MAX_ZOOM,
} from '../constants/app';
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
  fetchMissionsFromBackend,
  fetchDroneLogsFromBackend,
  createDroneLogInBackend,
  fetchMissionAiResultFromBackend,
  deleteMissionAiResultInBackend,
  deleteAllMissionAiResultsInBackend,
  postTelemetryToBackend,
  multipartInitForVideo,
  multipartPresignPart,
  multipartCompleteForVideo,
  multipartListParts,
  clearApiSession,
} from '../api/backend';
import {
  calculateDistance,
  calculateBearing,
} from '../utils/flight_Calculator';
import { computeMissionParamsFromPath } from '../utils/mission_Params';
import {
  normalizeConfirmText,
  readLogsClearedAtMs,
  writeLogsClearedAtMs,
  hasStoredApiToken,
  getStoredApiUser,
} from '../utils/app_Storage';
import {
  normalizeRoutePath,
  inferRouteProgressFromPosition,
  normalizeShiftSegmentIndices,
  createLocalDrones,
  mapBackendDroneToFrontend,
} from '../utils/drone_Runtime';
import {
  isPointInsideZoneBoundary,
  normalizeZoneName,
  nextZoneOrdinal,
  zoneColorNameFromHex,
  buildAutoZoneName,
  updateAutoZoneNameColor,
} from '../utils/zone_Geometry';
import {
  inferZoneIdForTemplatePath,
  collectSameZoneTemplateIds,
  buildAutoRouteTemplateName,
  mapBackendTemplateToFrontend,
} from '../utils/template_Mappers';
import { Zone_Map_Message_Overlay } from '../components/app/Zone_Map_Message_Overlay';

export function AppProvider({ children }) {
  const [hasStarted, setHasStarted] = useState(hasStoredApiToken);
  const [exitingToTemplates, setExitingToTemplates] = useState(false);
  const [missionTemplates, setMissionTemplates] = useState([]);

  const [confirmUi, setConfirmUi] = useState(null);
  const confirmResolveRef = useRef(null);
  const requestConfirm = useCallback((opts) => {
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirmUi({
        title: normalizeConfirmText(opts?.title, 'Подтверждение'),
        message: normalizeConfirmText(opts?.message, 'Вы уверены?'),
        warning: typeof opts?.warning === 'string' && opts.warning.trim() ? opts.warning.trim() : null,
        confirmText: normalizeConfirmText(opts?.confirmText, 'Да'),
        cancelText: normalizeConfirmText(opts?.cancelText, 'Нет'),
        tone: opts?.tone === 'danger' ? 'danger' : 'default',
      });
    });
  }, []);

  const resolveConfirm = useCallback((ok) => {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    setConfirmUi(null);
    if (typeof resolve === 'function') resolve(Boolean(ok));
  }, []);

  useEffect(() => {
    if (!confirmUi) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') resolveConfirm(false);
      if (e.key === 'Enter') resolveConfirm(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmUi, resolveConfirm]);

  const [templateEditMode, setTemplateEditMode] = useState(null);
  const [templateDraftPath, setTemplateDraftPath] = useState([]);
  const [templateDraftShiftSegments, setTemplateDraftShiftSegments] = useState([]);
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
    setTemplateDraftShiftSegments([]);
    setTemplateDraftName('');
    setTemplateDraftZoneId(null);
  }, []);
  const startEditTemplateRoute = useCallback((id) => {
    const t = missionTemplates.find((x) => x.id === id);
    if (!t) return;
    setTemplateEditMode({ type: 'edit', id });
    setTemplateDraftPath([...(t.path || [])]);
    setTemplateDraftShiftSegments(
      Array.isArray(t.shiftSegments)
        ? [...new Set(t.shiftSegments.filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b)
        : []
    );
    setTemplateDraftName(t.name || '');
    setTemplateDraftZoneId(t?.zoneId ?? null);
  }, [missionTemplates]);
  const cancelTemplateEdit = useCallback(() => {
    setNoTransitionTemplateSwitch(true);
    setTemplateEditMode(null);
    setTemplateDraftPath([]);
    setTemplateDraftShiftSegments([]);
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
          shiftSegments: [...templateDraftShiftSegments],
        });
      } else if (templateEditMode && templateEditMode.type === 'edit') {
        const current = missionTemplates.find((t) => t.id === templateEditMode.id);
        await updateRouteTemplateInBackend(templateEditMode.id, {
          name,
          path: [...templateDraftPath],
          zoneId: draftZoneId ?? current?.zoneId ?? null,
          shiftSegments: [...templateDraftShiftSegments],
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
    setTemplateDraftShiftSegments([]);
    setTemplateDraftName('');
    setTemplateDraftZoneId(null);
  }, [templateEditMode, templateDraftName, templateDraftPath, templateDraftShiftSegments, templateDraftZoneId, missionTemplates, reloadMissionTemplates]);
  const addTemplateDraftPoint = useCallback((latlng) => {
    setTemplateDraftPath((prev) => [...prev, [latlng.lat, latlng.lng]]);
  }, []);
  const undoTemplateDraftPoint = useCallback(() => {
    setTemplateDraftPath((prev) => (prev.length ? prev.slice(0, -1) : []));
  }, []);

  useEffect(() => {
    const maxSeg = templateDraftPath.length >= 2 ? templateDraftPath.length - 2 : -1;
    setTemplateDraftShiftSegments((prev) => {
      if (!Array.isArray(prev) || !prev.length) return prev;
      if (maxSeg < 0) return [];
      const next = prev.filter((i) => i >= 0 && i <= maxSeg);
      return next.length === prev.length ? prev : next;
    });
  }, [templateDraftPath]);

  const toggleTemplateDraftShiftSegment = useCallback((segmentIndex) => {
    const n = templateDraftPath.length;
    if (n < 2 || !Number.isInteger(segmentIndex)) return;
    if (segmentIndex < 0 || segmentIndex > n - 2) return;
    setTemplateDraftShiftSegments((prev) => {
      const cur = Array.isArray(prev) ? [...prev] : [];
      const j = cur.indexOf(segmentIndex);
      if (j >= 0) cur.splice(j, 1);
      else cur.push(segmentIndex);
      cur.sort((a, b) => a - b);
      return cur;
    });
  }, [templateDraftPath]);

  const [templateToApplyId, setTemplateToApplyId] = useState(null);

  const applyTemplateToDrone = useCallback((droneId, tplId) => {
    const tpl = missionTemplates.find((t) => t.id === tplId);
    if (!tpl || !tpl.path || !tpl.path.length) return;
    const normalizedShiftSegments = Array.isArray(tpl.shiftSegments)
      ? [...new Set(tpl.shiftSegments.filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b)
      : [];
    routeShiftSegmentsByDroneIdRef.current[String(droneId)] = normalizedShiftSegments;
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
    setRouteShiftSegmentsByDroneId((prev) => ({
      ...prev,
      [String(droneId)]: normalizedShiftSegments,
    }));
    setTemplateToApplyId(null);
  }, [missionTemplates]);

  const [drones, setDrones] = useState(() => createLocalDrones());
  const [backendSync, setBackendSync] = useState({ status: 'idle', message: '' });
  const [authReady, setAuthReady] = useState(hasStoredApiToken);
  const [aiResultsByMissionId, setAiResultsByMissionId] = useState({});
  const [aiPendingByMissionId, setAiPendingByMissionId] = useState({});
  const [aiCloudNotice, setAiCloudNotice] = useState(null);
  const [aiCloudNoticeUi, setAiCloudNoticeUi] = useState({ notice: null, visible: false, exiting: false });
  const [sidebarTab, setSidebarTab] = useState('control');
  const [routeShiftSegmentsByDroneId, setRouteShiftSegmentsByDroneId] = useState({});
  const authUser = useMemo(() => getStoredApiUser(), [authReady]);
  const authUserLabel = useMemo(() => {
    if (authUser?.name && String(authUser.name).trim()) return String(authUser.name).trim();
    if (authUser?.email && String(authUser.email).trim()) return String(authUser.email).trim();
    if (authUser?.id != null) return `ID ${authUser.id}`;
    return 'пользователь';
  }, [authUser]);
  const backendContextRef = useRef({ userId: null, zoneId: null });
  const backendMissionIdsRef = useRef(new Map());
  const missionDroneByMissionIdRef = useRef(new Map());
  const trackedMissionIdsRef = useRef(new Set());
  const seenAiResultKeysRef = useRef(new Set());
  const persistedDroneMapStateRef = useRef(new Map());
  const hasHydratedDronesRef = useRef(false);

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
    if (activeZoneId == null) return null;
    const activeIdKey = String(activeZoneId);
    const z = backendZones.find((x) => String(x?.id) === activeIdKey);
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
          isActive: activeZoneId != null && String(z.id) === String(activeZoneId),
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

  useEffect(() => {
    if (!backendZones.length) return;
    if (activeZoneId == null) {
      setActiveZoneId(backendZones[0].id);
      return;
    }
    const exists = backendZones.some((z) => String(z?.id) === String(activeZoneId));
    if (!exists) {
      setActiveZoneId(backendZones[0].id);
    }
  }, [backendZones, activeZoneId]);

  const dronesRef = useRef(drones);
  useEffect(() => {
    dronesRef.current = drones;
  }, [drones]);

  useEffect(() => {
    if (!authReady) return;
    if (!hasHydratedDronesRef.current) return;
    drones.forEach((drone) => {
      if (drone?.id == null) return;
      const position = drone?.position && Number.isFinite(Number(drone.position.lat)) && Number.isFinite(Number(drone.position.lng))
        ? { lat: Number(drone.position.lat), lng: Number(drone.position.lng) }
        : null;
      const payload = {
        latitude: position?.lat ?? null,
        longitude: position?.lng ?? null,
        is_visible: Boolean(drone?.isVisible),
        route_path: normalizeRoutePath(drone?.path),
        shift_segment_indices: normalizeShiftSegmentIndices(
          routeShiftSegmentsByDroneId[String(drone.id)]
        ),
      };
      const signature = JSON.stringify(payload);
      const key = String(drone.id);
      if (persistedDroneMapStateRef.current.get(key) === signature) return;
      persistedDroneMapStateRef.current.set(key, signature);
      void syncDroneStateToBackend(drone.id, payload).catch((e) =>
        console.warn('PATCH drone (map state):', e?.message ?? e)
      );
    });
  }, [drones, authReady, routeShiftSegmentsByDroneId]);

  useEffect(() => {
    if (authReady) return;
    persistedDroneMapStateRef.current = new Map();
    hasHydratedDronesRef.current = false;
  }, [authReady]);

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
          setRouteShiftSegmentsByDroneId(() => {
            const next = {};
            backendDrones.forEach((drone) => {
              const did = drone?.id;
              if (did == null) return;
              const normalized = normalizeShiftSegmentIndices(drone?.shift_segment_indices);
              if (normalized.length > 0) next[String(did)] = normalized;
            });
            return next;
          });
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
        hasHydratedDronesRef.current = true;

        try {
          const missions = await fetchMissionsFromBackend();
          if (!cancelled && Array.isArray(missions) && missions.length > 0) {
            const recentMissions = [...missions]
              .sort((a, b) => Number(b?.id ?? 0) - Number(a?.id ?? 0))
              .slice(0, 12);

            const isMissionActiveForPolling = (mission) => {
              const status = String(mission?.status ?? '').toLowerCase();
              return status === 'planned' || status === 'approved' || status === 'in_progress';
            };

            const activeMissionIds = [];
            const latestActiveMissionByDroneId = new Map();
            recentMissions.forEach((mission) => {
              const missionId = Number(mission?.id);
              if (!Number.isFinite(missionId)) return;
              const droneId = Number(mission?.drone_id);
              if (Number.isFinite(droneId)) {
                missionDroneByMissionIdRef.current.set(missionId, droneId);
              }
              if (isMissionActiveForPolling(mission)) {
                activeMissionIds.push(missionId);
                if (Number.isFinite(droneId)) {
                  const prev = latestActiveMissionByDroneId.get(droneId);
                  if (!prev || Number(mission?.id ?? 0) > Number(prev?.id ?? 0)) {
                    latestActiveMissionByDroneId.set(droneId, mission);
                  }
                }
              }
            });

            if (latestActiveMissionByDroneId.size > 0) {
              setDrones((prev) =>
                prev.map((drone) => {
                  const mission = latestActiveMissionByDroneId.get(Number(drone?.id));
                  if (!mission) return drone;
                  const missionId = Number(mission?.id);
                  if (Number.isFinite(missionId)) {
                    backendMissionIdsRef.current.set(drone.id, missionId);
                  }
                  const routePath = Array.isArray(mission?.routes)
                    ? [...mission.routes]
                      .sort((a, b) => Number(a?.sequence_number ?? 0) - Number(b?.sequence_number ?? 0))
                      .map((route) => [Number(route?.latitude), Number(route?.longitude)])
                      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))
                    : normalizeRoutePath(drone?.path);
                  const persistedDronePath = normalizeRoutePath(drone?.path);
                  const routePathForDrone =
                    persistedDronePath.length >= 2 ? persistedDronePath : routePath;
                  const missionStatus = String(mission?.status ?? '').toLowerCase();

                  let inferredFlightState = null;
                  if (missionStatus === 'in_progress' && routePathForDrone.length >= 2 && drone?.position) {
                    const missionParams = computeMissionParamsFromPath(
                      routePathForDrone,
                      drone?.maxSpeed,
                      drone?.battery
                    );
                    const inferred = inferRouteProgressFromPosition(routePathForDrone, drone.position);
                    if (missionParams && inferred) {
                      const elapsedMs = Math.max(
                        0,
                        Math.min(
                          Number(missionParams.totalTime ?? 0),
                          (Number(missionParams.totalTime ?? 0) * (inferred.progress / 100))
                        )
                      );
                      inferredFlightState = {
                        flightStatus: flightStatus.PAUSED,
                        isFlying: true,
                        missionParameters: missionParams,
                        missionElapsedTime: elapsedMs,
                        missionStartTime: Date.now() - elapsedMs,
                        currentWaypointIndex: inferred.segmentIndex,
                        flightProgress: inferred.progress,
                        speed: Number(missionParams.optimalSpeed ?? 0) / 3.6,
                        altitude: 100,
                        heading: calculateBearing(
                          routePathForDrone[inferred.segmentIndex][0],
                          routePathForDrone[inferred.segmentIndex][1],
                          routePathForDrone[Math.min(inferred.segmentIndex + 1, routePathForDrone.length - 1)][0],
                          routePathForDrone[Math.min(inferred.segmentIndex + 1, routePathForDrone.length - 1)][1]
                        ),
                      };
                    }
                  }

                  return {
                    ...drone,
                    path: routePathForDrone,
                    isVisible: drone?.isVisible || routePathForDrone.length > 0,
                    currentMission: {
                      id: mission?.id,
                      status: missionStatus,
                      backendRestored: true,
                      flightPath: routePath,
                      startTime: mission?.created_at ?? null,
                      completed: missionStatus === 'completed',
                      ...(inferredFlightState?.missionParameters
                        ? {
                            totalWaypoints: routePathForDrone.length,
                            totalDistance: inferredFlightState.missionParameters.totalDistance,
                            estimatedTime: inferredFlightState.missionParameters.estimatedTime,
                            missionParams: inferredFlightState.missionParameters,
                            flightPath: routePathForDrone,
                          }
                        : null),
                    },
                    status: missionStatus === 'in_progress' ? 'на задании' : drone.status,
                    backendStatus: missionStatus === 'in_progress' ? 'in_mission' : (drone.backendStatus ?? 'idle'),
                    ...(inferredFlightState ? inferredFlightState : null),
                  };
                })
              );
            }

            const restoredResults = {};
            for (const mission of recentMissions) {
              if (cancelled) return;
              const missionId = Number(mission?.id);
              if (!Number.isFinite(missionId)) continue;
              try {
                const payload = await fetchMissionAiResultFromBackend(missionId);
                const result = payload?.ai_result;
                if (!result) {
                  continue;
                }
                restoredResults[String(missionId)] = result;
                trackedMissionIdsRef.current.delete(missionId);
              } catch {
              }
            }

            if (!cancelled && Object.keys(restoredResults).length > 0) {
              setAiResultsByMissionId((prev) => ({ ...restoredResults, ...prev }));
              Object.entries(restoredResults).forEach(([missionId, result]) => {
                const versionKey = [
                  missionId,
                  result?.updated_at ?? '',
                  result?.bushes_count ?? '',
                  result?.gaps_count ?? '',
                ].join(':');
                seenAiResultKeysRef.current.add(versionKey);
              });
            }
            activeMissionIds.forEach((missionId) => {
              if (restoredResults[String(missionId)]) {
                trackedMissionIdsRef.current.delete(missionId);
              } else {
                trackedMissionIdsRef.current.add(missionId);
              }
            });
          }
        } catch (e) {
          console.warn('Restore ai panels failed:', e?.message ?? e);
        }

        try {
          const logs = await fetchDroneLogsFromBackend();
          if (!cancelled && Array.isArray(logs) && logs.length > 0) {
            const clearedAtMs = readLogsClearedAtMs();
            const filtered = clearedAtMs
              ? logs.filter((log) => {
                  const ts = Date.parse(log?.logged_at || '');
                  return !Number.isFinite(ts) ? true : ts > clearedAtMs;
                })
              : logs;

            setGlobalMissionLog(
              filtered.map((log, idx) => ({
                id: Number(log?.id) || Date.now() + idx,
                droneId: log?.drone_id ?? null,
                droneName: log?.drone_name || 'Неизвестный дрон',
                timestamp: log?.logged_at || new Date().toISOString(),
                message: String(log?.message ?? ''),
                data: log?.data && typeof log.data === 'object' ? log.data : {},
              }))
            );

            setDrones((prev) =>
              prev.map((drone) => {
                const perDrone = filtered
                  .filter((log) => Number(log?.drone_id) === Number(drone.id))
                  .map((log, idx) => ({
                    id: Number(log?.id) || Date.now() + idx,
                    timestamp: log?.logged_at || new Date().toISOString(),
                    message: String(log?.message ?? ''),
                    data: log?.data && typeof log.data === 'object' ? log.data : {},
                  }));
                if (!perDrone.length) return drone;
                return { ...drone, flightLog: perDrone };
              })
            );
          } else if (!cancelled) {
            setGlobalMissionLog([]);
            setDrones((prev) => prev.map((d) => (d.flightLog?.length ? { ...d, flightLog: [] } : d)));
          }
        } catch (e) {
          console.warn('Restore logs failed:', e?.message ?? e);
        }
      } catch (error) {
        if (cancelled) return;
        hasHydratedDronesRef.current = false;
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
  const [droneFocusRequest, setDroneFocusRequest] = useState(null);
  const [globalMissionLog, setGlobalMissionLog] = useState([]);
  const [weatherFlightSafe, setWeatherFlightSafe] = useState(true);
  const [weatherFlightReasons, setWeatherFlightReasons] = useState([]);
  const weatherFlightSafeRef = useRef(true);
  const activeTimersRef = useRef(new Map());

  const telemetryLastSentAtRef = useRef(new Map());
  const telemetrySendingRef = useRef(new Map());

  const videoRecordingByDroneRef = useRef(new Map());
  const videoRecorderConfigByDroneRef = useRef(new Map());
  const videoUploadInProgressRef = useRef(new Map());
  const videoSplitInProgressRef = useRef(new Map());
  const videoRowSplitStateRef = useRef(new Map());
  
  const routeShiftSegmentsByDroneIdRef = useRef({});

  const startVideoRecordingChunkForDrone = (droneId) => {
    const cfg = videoRecorderConfigByDroneRef.current.get(droneId);
    if (!cfg?.stream) return false;

    const recorder = cfg.mimeType
      ? new MediaRecorder(cfg.stream, { mimeType: cfg.mimeType })
      : new MediaRecorder(cfg.stream);
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

    recorder.start(1000);
    videoRecordingByDroneRef.current.set(droneId, { recorder, blobPromise });
    return true;
  };

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

  const toNormalizedShiftSegmentsForDrone = (droneId) => {
    const raw = routeShiftSegmentsByDroneIdRef.current[String(droneId)];
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
  };

  const uploadVideoMultipartForMission = async ({
    missionId,
    droneId,
    blob,
    rowIndex = null,
    rowsCount = null,
    shiftSegmentIndices = null,
  }) => {
    if (missionId == null) return;
    if (!blob || blob.size <= 0) return;
    if (videoUploadInProgressRef.current.get(droneId)) return;

    videoUploadInProgressRef.current.set(droneId, true);
    try {
      const normalizedShiftSegments = Array.isArray(shiftSegmentIndices)
        ? [...new Set(shiftSegmentIndices.filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b)
        : toNormalizedShiftSegmentsForDrone(droneId);
      const derivedRowsCount =
        Number.isInteger(rowsCount) && rowsCount > 0
          ? rowsCount
          : normalizedShiftSegments.length + 1;
      setAiPendingByMissionId((prev) => ({
        ...prev,
        [String(missionId)]: {
          rowsCount: derivedRowsCount,
          updatedAt: Date.now(),
        },
      }));
      const filenameRowSuffix = Number.isInteger(rowIndex) && rowIndex > 0 ? `_row_${rowIndex}` : '';
      const filename = `mission_${missionId}_drone_${droneId}${filenameRowSuffix}_${Date.now()}.webm`;
      const init = await multipartInitForVideo({
        missionId,
        filename,
        byteSize: blob.size,
        contentType: VIDEO_BACKEND_CONTENT_TYPE,
        chunkSizeBytes: VIDEO_MULTIPART_CHUNK_SIZE_BYTES,
        rowIndex,
        rowsCount: derivedRowsCount,
        shiftSegmentIndices: normalizedShiftSegments,
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

      missionDroneByMissionIdRef.current.set(missionId, droneId);
      trackedMissionIdsRef.current.add(missionId);
    } finally {
      videoUploadInProgressRef.current.delete(droneId);
    }
  };

  const handleWeatherFlightConditions = useCallback((conditions) => {
    const safe = Boolean(conditions?.safe);
    const reasons = Array.isArray(conditions?.reasons) ? conditions.reasons : [];
    weatherFlightSafeRef.current = safe;
    setWeatherFlightSafe(safe);
    setWeatherFlightReasons(reasons);
  }, []);

  const [placementMode, setPlacementMode] = useState(false);
  const [droneToPlace, setDroneToPlace] = useState(null);
  const [isRouteEditMode, setIsRouteEditMode] = useState(false);
  const [selectedDroneForSidebar, setSelectedDroneForSidebar] = useState(null);

  useEffect(() => {
    if (!weatherFlightSafe && placementMode) {
      setPlacementMode(false);
      setDroneToPlace(null);
    }
  }, [weatherFlightSafe, placementMode]);

  const selectedRouteEditPath = useMemo(() => {
    if (selectedDroneForSidebar == null) return null;
    const d = drones.find((x) => x.id === selectedDroneForSidebar);
    if (!d?.path?.length) return [];
    return d.path;
  }, [drones, selectedDroneForSidebar]);

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

  useEffect(() => {
    routeShiftSegmentsByDroneIdRef.current = routeShiftSegmentsByDroneId;
  }, [routeShiftSegmentsByDroneId]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [parkingOpen, setParkingOpen] = useState(false);
  const [workspaceTourOpen, setWorkspaceTourOpen] = useState(false);
  const [workspaceOnboardingStepId, setWorkspaceOnboardingStepId] = useState(null);
  const isTemplateCreationMode = templateEditMode === 'create';

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

  const handleSelectDroneForSidebar = useCallback(
    (droneId) => {
      setSelectedDroneForSidebar(droneId);
      if (drawRectZoneMode || templateEditMode || (placementMode && droneToPlace != null)) return;
      const drone = drones.find((d) => d.id === droneId);
      if (!drone || !drone.isVisible || !drone.position) return;
      const lat = Number(drone.position.lat);
      const lng = Number(drone.position.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const DRONE_FOCUS_MIN_ZOOM = 18;
      const DRONE_FOCUS_MAX_ZOOM = MAP_MAX_ZOOM;
      const targetZoom = Math.min(
        DRONE_FOCUS_MAX_ZOOM,
        Math.max(
          DRONE_FOCUS_MIN_ZOOM,
          Number.isFinite(mapZoom) ? mapZoom : DRONE_FOCUS_MIN_ZOOM
        )
      );
      setDroneFocusRequest({
        center: [lat, lng],
        zoom: targetZoom,
        nonce: Date.now(),
      });
    },
    [drones, drawRectZoneMode, templateEditMode, placementMode, droneToPlace, mapZoom]
  );

  const confirmApplyTemplateToSelectedDrone = useCallback(() => {
    if (!templateToApplyId || selectedDroneForSidebar == null) return;
    const drone = drones.find((d) => d.id === selectedDroneForSidebar);
    if (!drone || !drone.isVisible) return;
    if (drone.isFlying) return;
    applyTemplateToDrone(selectedDroneForSidebar, templateToApplyId);
  }, [templateToApplyId, selectedDroneForSidebar, drones, applyTemplateToDrone]);

  const cancelTemplatePreview = useCallback(() => {
    setTemplateToApplyId(null);
  }, []);

  const startDronePlacement = (droneId) => {
    if (!weatherFlightSafeRef.current) return;
    setDroneToPlace(droneId);
    setPlacementMode(true);
  };

  const placeDroneOnMap = (latlng) => {
    if (!droneToPlace || !placementMode) return;
    if (!weatherFlightSafeRef.current) return;
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
  }, [selectedDroneForSidebar, activeZoneBoundary]);

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
          flightLog: [logEntry, ...d.flightLog]
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

    setGlobalMissionLog(prev => [globalLogEntry, ...prev]);
    if (authReady) {
      void createDroneLogInBackend({
        droneId: droneId ?? null,
        message,
        data: safeData,
        loggedAt: globalLogEntry.timestamp,
      }).catch((e) => {
        console.warn('createDroneLogInBackend failed:', e?.message ?? e);
      });
    }
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
    setGlobalMissionLog((prev) => [zoneLogEntry, ...prev]);
  }, []);

  const aiResultsForSidebar = useMemo(() => {
    const entries = Object.entries(aiResultsByMissionId);
    if (!entries.length) return [];
    return entries
      .map(([missionId, result]) => {
        const numericMissionId = Number(missionId);
        const droneId = missionDroneByMissionIdRef.current.get(numericMissionId);
        const droneName = drones.find((d) => d.id === droneId)?.name ?? null;
        return {
          missionId: numericMissionId,
          droneId: droneId ?? null,
          droneName,
          bushesCount: Number(result?.bushes_count ?? 0),
          gapsCount: Number(result?.gaps_count ?? 0),
          rowsCount: Number(result?.rows_count ?? result?.shards_count ?? 0),
          processedRows: Number(result?.processed_shards ?? 0),
          bushesPositions: Array.isArray(result?.bushes_positions) ? result.bushes_positions : [],
          gapsPositions: Array.isArray(result?.gaps_positions) ? result.gaps_positions : [],
          rowSequences: Array.isArray(result?.row_sequences) ? result.row_sequences : [],
          updatedAt: result?.updated_at ?? null,
          createdAt: result?.created_at ?? null,
        };
      })
      .sort((a, b) => {
        const aTs = Date.parse(a.updatedAt ?? a.createdAt ?? 0);
        const bTs = Date.parse(b.updatedAt ?? b.createdAt ?? 0);
        return bTs - aTs;
      });
  }, [aiResultsByMissionId, drones]);

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
      try {
        const active = await fetchActiveMissionsForDrone(drone.id);
        if (Array.isArray(active) && active.length > 0) {
          const latestActive = [...active].sort((a, b) => Number(b?.id ?? 0) - Number(a?.id ?? 0))[0];
          const existingMissionId = Number(latestActive?.id);
          if (Number.isFinite(existingMissionId)) {
            backendMissionIdsRef.current.set(drone.id, existingMissionId);
            missionDroneByMissionIdRef.current.set(existingMissionId, drone.id);
            trackedMissionIdsRef.current.add(existingMissionId);
            return existingMissionId;
          }
        }
      } catch (existingErr) {
        console.warn('fetch existing active mission failed:', existingErr?.message ?? existingErr);
      }
      const inferredZoneId = inferZoneIdForTemplatePath(routePath, backendZones);
      const missionZoneId = inferredZoneId ?? ctx.zoneId;
      const createOnce = async () => createMissionInBackend({
        userId: ctx.userId,
        zoneId: missionZoneId,
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
      try {
        const numericMissionId = Number(missionId);
        if (Number.isFinite(numericMissionId)) {
          missionDroneByMissionIdRef.current.set(numericMissionId, drone.id);
          trackedMissionIdsRef.current.add(numericMissionId);
          setAiPendingByMissionId((prev) => ({
            ...prev,
            [String(numericMissionId)]: true,
          }));
        }
      } catch {
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
      return missionId;
    } catch (error) {
      console.warn('Синхронизация миссии с backend:', error?.message ?? error);
      addToGlobalLog(drone.id, '⚠️ Миссия не синхронизирована с backend', {
        error: String(error?.message ?? error),
      });
      return null;
    }
  }, [hydrateBackendContext, addToGlobalLog, fetchActiveMissionsForDrone, backendZones]);

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
      trackedMissionIdsRef.current.delete(missionId);
      missionDroneByMissionIdRef.current.delete(missionId);
      setAiPendingByMissionId((prev) => {
        if (!(String(missionId) in prev)) return prev;
        const copy = { ...prev };
        delete copy[String(missionId)];
        return copy;
      });
    } catch (e) {
      console.warn('cancel mission:', e?.message ?? e);
    }
  }, []);

  const openBushesPanelForMission = useCallback((missionId) => {
    const droneId = missionDroneByMissionIdRef.current.get(Number(missionId));
    if (droneId != null) {
      setSelectedDroneForSidebar(droneId);
    }
    setSidebarTab('bushes');
    setSidebarOpen(true);
    setParkingOpen(false);
  }, []);

  const deleteAiResultForMission = useCallback(async (missionId) => {
    if (missionId == null) return;
    const ok = await requestConfirm({
      title: 'Удаление результата миссии',
      message: `Удалить результат миссии #${missionId}?`,
      confirmText: 'Да, удалить',
      cancelText: 'Нет',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteMissionAiResultInBackend(missionId);
      const key = String(missionId);
      setAiResultsByMissionId((prev) => {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      setAiPendingByMissionId((prev) => {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      trackedMissionIdsRef.current.delete(Number(missionId));
      seenAiResultKeysRef.current.forEach((k) => {
        if (String(k).startsWith(`${missionId}:`)) {
          seenAiResultKeysRef.current.delete(k);
        }
      });
      if (Number(aiCloudNotice?.missionId) === Number(missionId)) {
        setAiCloudNotice(null);
      }
    } catch (e) {
      window.alert(`Не удалось удалить результат миссии #${missionId}: ${String(e?.message ?? e)}`);
    }
  }, [aiCloudNotice, requestConfirm]);

  const deleteAllAiResults = useCallback(async () => {
    const ok = await requestConfirm({
      title: 'Удаление результатов',
      message: 'Удалить результаты всех миссий?',
      confirmText: 'Да, удалить',
      cancelText: 'Нет',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteAllMissionAiResultsInBackend();
      setAiResultsByMissionId({});
      setAiPendingByMissionId({});
      setAiCloudNotice(null);
      seenAiResultKeysRef.current.clear();
      trackedMissionIdsRef.current.clear();
    } catch (e) {
      window.alert(`Не удалось удалить все результаты: ${String(e?.message ?? e)}`);
    }
  }, [requestConfirm]);

  useEffect(() => {
    if (!authReady) return;

    let cancelled = false;
    const poll = async () => {
      const missionIds = Array.from(trackedMissionIdsRef.current.values())
        .sort((a, b) => Number(b) - Number(a))
        .slice(0, 8);
      if (!missionIds.length) return;

      for (const missionId of missionIds) {
        if (cancelled) return;
        try {
          const payload = await fetchMissionAiResultFromBackend(missionId);
          const result = payload?.ai_result;
          if (!result) {
            continue;
          }

          setAiResultsByMissionId((prev) => {
            const prevResult = prev[String(missionId)];
            if (prevResult?.updated_at === result.updated_at) return prev;
            return { ...prev, [String(missionId)]: result };
          });
          setAiPendingByMissionId((prev) => {
            if (!(String(missionId) in prev)) return prev;
            const copy = { ...prev };
            delete copy[String(missionId)];
            return copy;
          });
          trackedMissionIdsRef.current.delete(missionId);

          const versionKey = [
            missionId,
            result?.updated_at ?? '',
            result?.bushes_count ?? '',
            result?.gaps_count ?? '',
          ].join(':');
          if (!seenAiResultKeysRef.current.has(versionKey)) {
            seenAiResultKeysRef.current.add(versionKey);
            const droneId = missionDroneByMissionIdRef.current.get(Number(missionId));
            const droneName = dronesRef.current.find((d) => d.id === droneId)?.name;
            setAiCloudNotice({
              missionId: Number(missionId),
              droneName: droneName ?? null,
              bushesCount: Number(result?.bushes_count ?? 0),
              gapsCount: Number(result?.gaps_count ?? 0),
            });
          }
        } catch (e) {
          console.warn('poll ai_result failed:', e?.message ?? e);
        }
      }
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, AI_RESULTS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [authReady]);

  const isDroneAtMissionStart = useCallback((drone) => {
    if (!drone?.path || drone.path.length < 2 || !drone.position) return false;
    const first = drone.path[0];
    if (!Array.isArray(first) || first.length < 2) return false;
    return (
      calculateDistance(drone.position.lat, drone.position.lng, first[0], first[1]) <=
      FIRST_WAYPOINT_TRANSIT_THRESHOLD_M
    );
  }, []);

  const startDroneFlight = useCallback(async (droneId) => {
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
    const missionId = await createAndStartBackendMission(drone, drone.path);
    if (!missionId) {
      addToDroneLog(droneId, '⚠️ Старт отменён: backend миссия не создалась');
      setDrones(prev =>
        prev.map(d => {
          if (d.id !== droneId) return d;
          return {
            ...d,
            flightStatus: flightStatus.IDLE,
            isFlying: false,
            speed: 0,
            altitude: 0,
            missionElapsedTime: 0,
            flightProgress: 0,
            currentWaypointIndex: 0
          };
        })
      );
      return;
    }
    addToDroneLog(droneId, '🛸 Старт с первой точки маршрута');
    setTimeout(() => startFlightMovement(droneId), 0);
  }, [
    drones,
    selectedDroneForSidebar,
    isRouteEditMode,
    addToDroneLog,
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
          videoRecorderConfigByDroneRef.current.set(droneId, {
            stream,
            mimeType: recorderMimeType || null
          });
          startVideoRecordingChunkForDrone(droneId);
        }
      }
    } catch (e) {
      console.warn('Video recording init failed:', e?.message ?? e);
    }

    if (!drone?.currentMission?.flyToFirstOnly) {
      const shiftSegs = toNormalizedShiftSegmentsForDrone(droneId);
      const rowsCount = shiftSegs.length + 1;
      videoRowSplitStateRef.current.set(droneId, {
        shiftSegments: shiftSegs,
        rowsCount,
        currentRowIndex: 1,
        lastSplitSegmentIndex: null,
        missionId: backendMissionIdsRef.current.get(droneId) ?? null
      });
    } else {
      videoRowSplitStateRef.current.delete(droneId);
    }
    videoSplitInProgressRef.current.set(droneId, false);

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

      const rowSplitState = videoRowSplitStateRef.current.get(droneId);
      if (rowSplitState) {
        rowSplitState.missionId = missionId ?? rowSplitState.missionId;
        if (!rowSplitState.shiftSegments.length) {
          const lateShiftSegs = toNormalizedShiftSegmentsForDrone(droneId);
          if (lateShiftSegs.length) {
            rowSplitState.shiftSegments = lateShiftSegs;
            rowSplitState.rowsCount = lateShiftSegs.length + 1;
          }
        }
      }

      if (
        rowSplitState &&
        !currentDrone.currentMission?.flyToFirstOnly &&
        rowSplitState.shiftSegments.length > 0 &&
        rowSplitState.shiftSegments.includes(currentSegment) &&
        rowSplitState.lastSplitSegmentIndex !== currentSegment &&
        !videoSplitInProgressRef.current.get(droneId)
      ) {
        rowSplitState.lastSplitSegmentIndex = currentSegment;
        videoSplitInProgressRef.current.set(droneId, true);
        void (async () => {
          try {
            const finishedRow = rowSplitState.currentRowIndex;
            const blob = await stopVideoRecordingForDrone(droneId);
            if (rowSplitState.missionId && blob) {
              await uploadVideoMultipartForMission({
                missionId: rowSplitState.missionId,
                droneId,
                blob,
                rowIndex: finishedRow,
                rowsCount: rowSplitState.rowsCount,
                shiftSegmentIndices: rowSplitState.shiftSegments
              });
            }
            rowSplitState.currentRowIndex = finishedRow + 1;
            startVideoRecordingChunkForDrone(droneId);
            addToDroneLog(droneId, `🎞️ Ряд ${finishedRow} записан, начат ряд ${rowSplitState.currentRowIndex}`);
          } catch (e) {
            console.warn('Row split video upload failed:', e?.message ?? e);
          } finally {
            videoSplitInProgressRef.current.set(droneId, false);
          }
        })();
      }

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
      videoRowSplitStateRef.current.delete(droneId);
      videoSplitInProgressRef.current.delete(droneId);
      videoRecorderConfigByDroneRef.current.delete(droneId);
      void syncDroneStateToBackend(droneId, { status: 'idle' }).catch((e) =>
        console.warn('PATCH drone (долёт до старта):', e?.message ?? e)
      );
      void completeBackendMissionForDrone(droneId);
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
      const rowSplitState = videoRowSplitStateRef.current.get(droneId);
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
            rowIndex: rowSplitState?.currentRowIndex ?? null,
            rowsCount: rowSplitState?.rowsCount ?? null,
            shiftSegmentIndices: rowSplitState?.shiftSegments ?? null
          });
        } catch (e) {
          console.warn('Video multipart upload failed:', e?.message ?? e);
        }
      }
      videoRowSplitStateRef.current.delete(droneId);
      videoSplitInProgressRef.current.delete(droneId);
      videoRecorderConfigByDroneRef.current.delete(droneId);
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
    videoRowSplitStateRef.current.delete(droneId);
    videoSplitInProgressRef.current.delete(droneId);
    videoRecorderConfigByDroneRef.current.delete(droneId);
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
    setIsRouteEditMode(false);

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
      void (async () => {
        const missionId = await createAndStartBackendMission(drone, flightPath);
        if (!missionId) {
          addToDroneLog(droneId, '⚠️ Перелёт отменён: backend миссия не создалась');
          setDrones(prev =>
            prev.map(d => {
              if (d.id !== droneId) return d;
              return {
                ...d,
                flightStatus: flightStatus.IDLE,
                isFlying: false,
                speed: 0,
                altitude: 0,
                missionElapsedTime: 0,
                flightProgress: 0,
                currentWaypointIndex: 0
              };
            })
          );
          return;
        }
        startFlightMovement(droneId);
      })();
    }, 2000);
  }, [drones, addToDroneLog, createAndStartBackendMission]);

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
    if (templateId) {
      setSelectedDroneForSidebar(null);
      setIsRouteEditMode(false);
      setTemplateToApplyId(templateId);
      return;
    }
    setTemplateToApplyId(null);
  };

  const handleLogout = useCallback(() => {
    clearApiSession();
    backendMissionIdsRef.current = new Map();
    missionDroneByMissionIdRef.current = new Map();
    trackedMissionIdsRef.current = new Set();
    seenAiResultKeysRef.current = new Set();
    backendContextRef.current = { userId: null, zoneId: null };
    activeTimersRef.current.forEach((id) => clearInterval(id));
    activeTimersRef.current.clear();
    setDrones(createLocalDrones());
    setRouteShiftSegmentsByDroneId({});
    setBackendSync({ status: 'idle', message: '' });
    setAiResultsByMissionId({});
    setAiPendingByMissionId({});
    setAiCloudNotice(null);
    setSidebarTab('control');
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
    videoRecorderConfigByDroneRef.current = new Map();
    videoUploadInProgressRef.current = new Map();
    videoSplitInProgressRef.current = new Map();
    videoRowSplitStateRef.current = new Map();
    routeShiftSegmentsByDroneIdRef.current = {};
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

  const getZoneCreateConflictMessage = useCallback((err) => {
    const raw = String(err?.message ?? err ?? '');
    const text = raw.toLowerCase();
    if (
      text.includes('не должна пересекаться или соприкасаться') ||
      (text.includes('пересек') && text.includes('соприкас')) ||
      (text.includes('boundary') && text.includes('пересек'))
    ) {
      return 'Нельзя создать (или обновить) зону поверх другой: зоны не должны пересекаться и соприкасаться.';
    }
    return raw;
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
      setZoneKmlMessage(getZoneCreateConflictMessage(err));
      setZoneKmlIsError(true);
    } finally {
      setRectZoneBusy(false);
    }
  }, [draftRectBoundary, newRectZoneName, editingZoneId, addToZoneLog, templateEditMode, templateDraftZoneId, backendZones, activeZoneId, draftRectZoneColor, getZoneCreateConflictMessage]);

  const handleDeleteActiveZone = useCallback(async () => {
    if (activeZoneId == null) return;
    const zoneIdToDelete = activeZoneId;
    const usageCount = Number(templateUsageByZoneId[String(zoneIdToDelete)] || 0);
    if (usageCount > 0) {
      const zoneName = backendZones.find((z) => z.id === zoneIdToDelete)?.name ?? `ID ${zoneIdToDelete}`;
      addToZoneLog('⛔ Нельзя удалить зону: она используется в шаблонах', {
        zoneId: zoneIdToDelete,
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
    const confirmed = await requestConfirm({
      title: 'Удаление зоны',
      message:
        `Удалить зону ${title}? Это действие нельзя отменить.`,
      warning: 'Обычные маршруты миссий внутри этой зоны (не шаблоны) будут удалены автоматически.',
      confirmText: 'Да, удалить',
      cancelText: 'Нет',
      tone: 'danger',
    });
    if (!confirmed) return;

    setRectZoneBusy(true);
    try {
      await deleteZoneInBackend(zoneIdToDelete);
      const zones = await fetchZonesFromBackend();
      setBackendZones(zones);
      const deletedBoundary = targetZone?.boundary;
      let clearedRoutes = 0;
      if (Array.isArray(deletedBoundary) && deletedBoundary.length >= 4) {
        setDrones((prev) =>
          prev.map((d) => {
            if (!Array.isArray(d?.path) || d.path.length === 0) return d;
            const touchesDeletedZone = d.path.some(
              (point) =>
                Array.isArray(point) &&
                point.length >= 2 &&
                isPointInsideZoneBoundary(deletedBoundary, { lat: point[0], lng: point[1] })
            );
            if (!touchesDeletedZone) return d;
            clearedRoutes += 1;
            return {
              ...d,
              path: [],
              missionParameters: null,
              currentWaypointIndex: 0,
              flightProgress: 0,
            };
          })
        );
      }
      addToZoneLog('🗑️ Зона удалена', {
        zoneId: zoneIdToDelete,
        zoneName: targetZone?.name ?? `ID ${zoneIdToDelete}`,
        clearedRoutes,
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
  }, [activeZoneId, backendZones, addToZoneLog, templateUsageByZoneId, requestConfirm]);

  const handleDeleteZoneFromMenu = useCallback(async (zoneId, options = null) => {
    const zoneIdToDelete = Number(zoneId);
    if (!Number.isFinite(zoneIdToDelete)) return;
    const usageCount = Number(templateUsageByZoneId[String(zoneIdToDelete)] || 0);
    if (usageCount > 0) {
      const zoneName = backendZones.find((z) => z.id === zoneIdToDelete)?.name ?? `ID ${zoneIdToDelete}`;
      addToZoneLog('⛔ Нельзя удалить зону: она используется в шаблонах', {
        zoneId: zoneIdToDelete,
        zoneName,
        templates: usageCount,
      });
      window.alert(
        `Нельзя удалить зону «${zoneName}»: она используется в ${usageCount} шаблон(ах).\nУдаляйте/переносите шаблоны только в Shablone_screen.`
      );
      return;
    }
    const targetZone = backendZones.find((z) => z.id === zoneIdToDelete);
    const title = targetZone?.name ? `«${targetZone.name}»` : `ID ${zoneIdToDelete}`;
    const skipConfirm = Boolean(options?.skipConfirm);
    if (!skipConfirm) {
      const confirmed = await requestConfirm({
        title: 'Удаление зоны',
        message: `Удалить зону ${title}? Это действие нельзя отменить.`,
        warning: 'Обычные маршруты миссий внутри этой зоны (не шаблоны) будут удалены автоматически.',
        confirmText: 'Да, удалить',
        cancelText: 'Нет',
        tone: 'danger',
      });
      if (!confirmed) return;
    }

    setRectZoneBusy(true);
    try {
      await deleteZoneInBackend(zoneIdToDelete);
      const zones = await fetchZonesFromBackend();
      setBackendZones(zones);
      const deletedBoundary = targetZone?.boundary;
      let clearedRoutes = 0;
      if (Array.isArray(deletedBoundary) && deletedBoundary.length >= 4) {
        setDrones((prev) =>
          prev.map((d) => {
            if (!Array.isArray(d?.path) || d.path.length === 0) return d;
            const touchesDeletedZone = d.path.some(
              (point) =>
                Array.isArray(point) &&
                point.length >= 2 &&
                isPointInsideZoneBoundary(deletedBoundary, { lat: point[0], lng: point[1] })
            );
            if (!touchesDeletedZone) return d;
            clearedRoutes += 1;
            return {
              ...d,
              path: [],
              missionParameters: null,
              currentWaypointIndex: 0,
              flightProgress: 0,
            };
          })
        );
      }
      addToZoneLog('🗑️ Зона удалена', {
        zoneId: zoneIdToDelete,
        zoneName: targetZone?.name ?? `ID ${zoneIdToDelete}`,
        clearedRoutes,
      });

      const currentActiveStillExists = zones.some((z) => z.id === activeZoneId);
      const nextActiveZoneId =
        zoneIdToDelete === activeZoneId || !currentActiveStillExists
          ? (zones.length > 0 ? zones[0].id : null)
          : activeZoneId;
      setActiveZoneId(nextActiveZoneId);
      const userId = backendContextRef.current.userId ?? null;
      backendContextRef.current = { userId, zoneId: nextActiveZoneId };

      if (editingZoneId != null && String(editingZoneId) === String(zoneIdToDelete)) {
        setEditingZoneId(null);
        setDrawRectZoneMode(false);
        setDraftRectBoundary(null);
      }
    } catch (err) {
      setZoneKmlMessage(String(err?.message ?? err));
      setZoneKmlIsError(true);
    } finally {
      setRectZoneBusy(false);
    }
  }, [activeZoneId, editingZoneId, backendZones, addToZoneLog, templateUsageByZoneId, requestConfirm]);

  const handleDeleteTemplateFromMenu = useCallback(async (templateId, mode = 'route_only') => {
    const template = missionTemplates.find((t) => t.id === templateId);
    if (!template) return;
    const resolveTemplateZoneId = (tpl) =>
      tpl?.zoneId ?? inferZoneIdForTemplatePath(tpl?.path, backendZones);
    const templateZoneId = resolveTemplateZoneId(template);
    const sameZoneTemplateIds = collectSameZoneTemplateIds(templateId, missionTemplates, backendZones);
    const otherCount = Math.max(0, sameZoneTemplateIds.length - 1);

    if (mode === 'route_and_zone' && otherCount > 0) {
      const cascadeOk = await requestConfirm({
        title: 'Внимание: каскадное удаление',
        message:
          `Вместе с выбранным шаблоном будут удалены ещё ${otherCount} шаблон(а/ов), ` +
          'так как они находятся в той же зоне.\nПродолжить?',
        confirmText: 'Да',
        cancelText: 'Нет',
        tone: 'danger',
      });
      if (!cascadeOk) return;
    }

    if (mode === 'route_and_zone' && templateZoneId != null) {
      const zoneId = templateZoneId;
      const zone = backendZones.find((z) => String(z.id) === String(zoneId));
      const zoneTitle = zone?.name ? `«${zone.name}»` : `ID ${zoneId}`;
      const ok = await requestConfirm({
        title: 'Удаление шаблона и зоны',
        message:
          otherCount > 0
            ? `Удалить шаблон «${template.name || 'Без названия'}», связанную зону ${zoneTitle} и ещё ${otherCount} шаблон(а/ов) этой зоны?\nЭто действие нельзя отменить.`
            : `Удалить шаблон «${template.name || 'Без названия'}» и связанную зону ${zoneTitle}?\nЭто действие нельзя отменить.`,
        confirmText: 'Да, удалить',
        cancelText: 'Нет',
        tone: 'danger',
      });
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
      const ok = await requestConfirm({
        title: 'Удаление шаблона',
        message: `Удалить только шаблон «${template.name || 'Без названия'}»?\nМаршрут будет удалён из шаблонов, зоны останутся.`,
        confirmText: 'Да, удалить',
        cancelText: 'Нет',
        tone: 'danger',
      });
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
  }, [missionTemplates, backendZones, reloadMissionTemplates, requestConfirm]);

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
        setZoneKmlMessage(getZoneCreateConflictMessage(err));
        setZoneKmlIsError(true);
      } finally {
        setZoneKmlBusy(false);
      }
    },
    [activeZoneId, newZoneKmlName, addToZoneLog, backendZones, draftRectZoneColor, getZoneCreateConflictMessage]
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

  const clearLogs = useCallback(() => {
    const now = Date.now();
    writeLogsClearedAtMs(now);
    setGlobalMissionLog([]);
    setDrones((prev) =>
      prev.map((d) => (d.flightLog?.length ? { ...d, flightLog: [] } : d))
    );
  }, []);

  const [zoneMapMessageUi, setZoneMapMessageUi] = useState({
    message: null,
    isError: false,
    visible: false,
  });

  useEffect(() => {
    let hideTimerId;
    let rafId;
    if (zoneKmlMessage) {
      setZoneMapMessageUi({
        message: zoneKmlMessage,
        isError: Boolean(zoneKmlIsError),
        visible: false,
      });
      rafId = window.requestAnimationFrame(() => {
        setZoneMapMessageUi((prev) => ({ ...prev, visible: true }));
      });
    } else {
      setZoneMapMessageUi((prev) => {
        if (!prev.message) return prev;
        return { ...prev, visible: false };
      });
      hideTimerId = window.setTimeout(() => {
        setZoneMapMessageUi((prev) => ({ ...prev, message: null }));
      }, 260);
    }
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (hideTimerId) window.clearTimeout(hideTimerId);
    };
  }, [zoneKmlMessage, zoneKmlIsError]);

  const zoneMapMessageOverlay = zoneMapMessageUi.message ? (
    <Zone_Map_Message_Overlay
      message={zoneMapMessageUi.message}
      isError={zoneMapMessageUi.isError}
      visible={zoneMapMessageUi.visible}
      onDismiss={() => setZoneKmlMessage(null)}
    />
  ) : null;

  useEffect(() => {
    if (!zoneKmlMessage) return undefined;
    const timerId = window.setTimeout(() => {
      setZoneKmlMessage(null);
    }, 7000);
    return () => window.clearTimeout(timerId);
  }, [zoneKmlMessage]);

  useEffect(() => {
    let hideTimerId;
    let rafId;
    if (aiCloudNotice) {
      setAiCloudNoticeUi({ notice: aiCloudNotice, visible: false, exiting: false });
      rafId = window.requestAnimationFrame(() => {
        setAiCloudNoticeUi((prev) => ({ ...prev, visible: true }));
      });
    } else {
      setAiCloudNoticeUi((prev) => {
        if (!prev.notice) return prev;
        return { ...prev, visible: false, exiting: true };
      });
      hideTimerId = window.setTimeout(() => {
        setAiCloudNoticeUi((prev) => ({ ...prev, notice: null, exiting: false }));
      }, 310);
    }
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (hideTimerId) window.clearTimeout(hideTimerId);
    };
  }, [aiCloudNotice]);


  const onLoggedIn = useCallback(() => {
    resetWorkspaceOnboardingForLogin();
    resetTemplatesOnboardingForLogin();
    setAuthReady(true);
    setExitingToTemplates(false);
    setHasStarted(true);
  }, []);


  const workspaceVisible = hasStarted && !exitingToTemplates;

  const ctx = {
    onLoggedIn,
    authReady,
    workspaceVisible,
    hasStarted,
    exitingToTemplates,
    setExitingToTemplates,
    setHasStarted,
    missionTemplates,
    confirmUi,
    resolveConfirm,
    templateEditMode,
    templateDraftPath,
    templateDraftShiftSegments,
    templateDraftName,
    setTemplateDraftName,
    saveTemplateDraft,
    cancelTemplateEdit,
    undoTemplateDraftPoint,
    toggleDrawRectZoneMode,
    drawRectZoneMode,
    draftRectBoundary,
    newRectZoneName,
    setNewRectZoneName,
    draftRectZoneColor,
    handleDraftRectZoneColorChange,
    saveDraftRectZone,
    rectZoneBusy,
    zoneKmlBusy,
    editingZoneId,
    cancelDraftRectZone,
    noTransitionTemplateSwitch,
    handleStart,
    startCreateTemplate,
    startEditTemplateRoute,
    handleDeleteTemplateFromMenu,
    templateCascadeCountById,
    templateCascadeMetaById,
    drones,
    mapCenter,
    mapZoom,
    setMapCenter,
    setMapZoom,
    handleMapClick,
    handleZoneClickToEdit,
    handleDraftRectBoundaryChange,
    handleRectDrawComplete,
    handleTemplateRoutePathChange,
    toggleTemplateDraftShiftSegment,
    zonesForMap,
    activeZoneBoundary,
    activeZoneColor,
    zoneFitNonce,
    zoneMapMessageOverlay,
    handleWeatherFlightConditions,
    weatherFlightSafe,
    weatherFlightReasons,
    handleDronePositionChange,
    selectedDroneForSidebar,
    droneFocusRequest,
    isRouteEditMode,
    selectedRouteEditPath,
    handleRoutePathChange,
    selectedRouteShiftSegments,
    toggleRouteShiftSegment,
    workspaceOnboardingStepId,
    templateToApplyId,
    placementMode,
    droneToPlace,
    cancelTemplatePreview,
    confirmApplyTemplateToSelectedDrone,
    backendZones,
    activeZoneId,
    applyActiveZoneId,
    handleDeleteZoneFromMenu,
    templateUsageByZoneId,
    handleDeleteActiveZone,
    workspaceTourOpen,
    handleOnboardingBeforeStep,
    handleWorkspaceTourOpenChange,
    cancelDronePlacement,
    selectedDroneForModal,
    setSelectedDroneForModal,
    globalMissionLog,
    aiResultsForSidebar,
    deleteAiResultForMission,
    deleteAllAiResults,
    sidebarTab,
    setSidebarTab,
    getActiveFlights,
    startDroneFlight,
    pauseDroneFlight,
    resumeDroneFlight,
    stopDroneFlight,
    stopAllFlights,
    addRoutePoint,
    undoLastPoint,
    clearRoute,
    clearLogs,
    handleSelectDroneForSidebar,
    handleToggleRouteMode,
    centerMapToFirstWaypoint,
    flyDroneToFirstWaypoint,
    isDroneAtMissionStart,
    workZoneReady,
    authUserLabel,
    handleLogout,
    isTemplateCreationMode,
    aiCloudNoticeUi,
    setAiCloudNotice,
    openBushesPanelForMission,
    sidebarOpen,
    parkingOpen,
    setSidebarOpen,
    setParkingOpen,
    startDronePlacement,
    removeDroneFromMap,
    createDroneFromParking,
    handleDroneClick,
  };

  return <AppContext.Provider value={ctx}>{children}</AppContext.Provider>;
}

export { useApp } from './App_Context';