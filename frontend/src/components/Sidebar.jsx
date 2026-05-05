import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { flightStatus } from '../constants/drones_data';
import { getTourDemoDrone, isTourDemoDrone } from '../constants/tour_Demo_Drone';
import { calculateDistance, calculateOptimalSpeed, calculateFlightTime } from '../utils/flight_Calculator';

export const Sidebar = ({
  dronesData = [],
  selectedDroneId,
  onSelectDrone,
  missionLog = [],
  activeFlights = [],
  onStartFlight,
  onPauseFlight,
  onResumeFlight,
  onStopFlight,
  onStopAllFlights,
  onAddRoutePoint,
  onUndoLastPoint,
  onClearRoute,
  onClearLogs,
  onDroneClick,
  isRouteEditMode = false,
  onToggleRouteMode,
  onCenterToFirstWaypoint,
  onFlyToFirstWaypoint,
  flightAllowedByWeather = true,
  weatherFlightReasons = [],
  isDroneAtMissionStart,
  workZoneReady = false,
  instructionTourActive = false,
  aiResults = [],
  onDeleteAiMissionResult,
  onDeleteAllAiMissionResults,
  suspendAutoSelectDrone = false,
  initialTab = 'control',
  onOpenAiMission,
  onTabChange,
  onClose
}) => {
  const isAllowedTab = (tab) => tab === 'control' || tab === 'logs' || tab === 'bushes';
  const [activeTab, setActiveTab] = useState(isAllowedTab(initialTab) ? initialTab : 'control');

  useEffect(() => {
    if (!isAllowedTab(initialTab)) return;
    setActiveTab((prev) => (prev === initialTab ? prev : initialTab));
  }, [initialTab]);

  useEffect(() => {
    if (typeof onTabChange === 'function') {
      onTabChange(activeTab);
    }
  }, [activeTab, onTabChange]);

  const tourDemoDrone = useMemo(() => getTourDemoDrone(), []);
  const visibleDrones = dronesData.filter((d) => d.isVisible);
  const listForPicker =
    visibleDrones.length > 0 ? visibleDrones : instructionTourActive ? [tourDemoDrone] : [];
  const selectedDrone =
    listForPicker.find((d) => d.id === selectedDroneId) ??
    (instructionTourActive && visibleDrones.length === 0 ? tourDemoDrone : null) ??
    (suspendAutoSelectDrone ? null : (visibleDrones.length > 0 ? visibleDrones[0] : null));

  const tourUiPreview = isTourDemoDrone(selectedDrone);

  const flyingDrones = visibleDrones.filter(d => d.isFlying);

  const getProgressColor = (progress) => {
    if (progress < 30) return 'bg-red-500';
    if (progress < 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getStatusColor = (drone) => {
    switch (drone.flightStatus) {
      case flightStatus.FLYING: return 'border-green-500 bg-green-900/20';
      case flightStatus.PAUSED: return 'border-yellow-500 bg-yellow-900/20';
      case flightStatus.TAKEOFF:
      case flightStatus.LANDING: return 'border-blue-500 bg-blue-900/20';
      case flightStatus.COMPLETED: return 'border-green-700 bg-green-900/20';
      default: return 'border-gray-500 bg-gray-900/20';
    }
  };

  const formatTimeSeconds = (seconds) => {
    const sec = Math.floor(Number(seconds) || 0);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const estimatedTimeSec = useMemo(() => {
    if (!selectedDrone?.path || selectedDrone.path.length < 2) return null;
    let totalDistance = 0;
    for (let i = 0; i < selectedDrone.path.length - 1; i++) {
      const [lat1, lng1] = selectedDrone.path[i];
      const [lat2, lng2] = selectedDrone.path[i + 1];
      totalDistance += calculateDistance(lat1, lng1, lat2, lng2);
    }
    const maxSpeed = selectedDrone.maxSpeed != null ? selectedDrone.maxSpeed : 70;
    const speed = calculateOptimalSpeed(totalDistance, maxSpeed / 3.6);
    return Math.round(calculateFlightTime(totalDistance, speed));
  }, [selectedDrone?.path, selectedDrone?.maxSpeed]);

  const getStatusText = (drone) => {
    switch (drone.flightStatus) {
      case flightStatus.FLYING: return 'В полете';
      case flightStatus.PAUSED: return 'На паузе';
      case flightStatus.TAKEOFF: return 'Взлетает';
      case flightStatus.LANDING: return 'Садится';
      case flightStatus.COMPLETED: return 'Миссия завершена';
      case flightStatus.IDLE: return 'На земле';
      default: return drone.flightStatus;
    }
  };
  const selectedDronePathLength = selectedDrone?.path?.length || 0;
  const selectedDroneStatus = selectedDrone?.flightStatus || flightStatus.IDLE;
  const [selectedAiMissionId, setSelectedAiMissionId] = useState(null);
  const [expandedSchemeMissionId, setExpandedSchemeMissionId] = useState(null);
  const expandedSvgRef = useRef(null);
  const expandedCanvasRef = useRef(null);
  const expandedCanvasWrapRef = useRef(null);
  const [expandedViewBox, setExpandedViewBox] = useState({ x: 0, y: 0, width: 1000, height: 600 });
  const [isExpandedPanning, setIsExpandedPanning] = useState(false);
  const [expandedPanStart, setExpandedPanStart] = useState(null);
  const expandedPanRafRef = useRef(null);
  const expandedPanLatestRef = useRef(null);
  const expandedDrawRafRef = useRef(null);
  const atMissionStart =
    typeof isDroneAtMissionStart === 'function' ? isDroneAtMissionStart(selectedDrone) : true;

  const parsePointXY = (value) => {
    if (Array.isArray(value) && value.length >= 2) {
      const x = Number(value[0]);
      const y = Number(value[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    if (value && typeof value === 'object') {
      const x = Number(value.x ?? value.lng ?? value.lon ?? value.longitude ?? value[0]);
      const y = Number(value.y ?? value.lat ?? value.latitude ?? value[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
    }
    return null;
  };

  const buildMissionSchemePoints = (result) => {
    const bushes = Array.isArray(result?.bushesPositions)
      ? result.bushesPositions.map(parsePointXY).filter(Boolean)
      : [];
    const gaps = Array.isArray(result?.gapsPositions)
      ? result.gapsPositions.map(parsePointXY).filter(Boolean)
      : [];
    return { bushes, gaps };
  };

  const buildRowsFromRowSequences = (result) => {
    const rawRows = Array.isArray(result?.rowSequences) ? result.rowSequences : [];
    if (!rawRows.length) return null;

    const normalized = rawRows
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const rowIndex = Number(row.row_index ?? row.rowIndex ?? row.shard_index ?? row.shardIndex);
        const sequence = Array.isArray(row.row_sequence ?? row.rowSequence)
          ? (row.row_sequence ?? row.rowSequence).map((v) => String(v)).filter((v) => v === 'bush' || v === 'gap')
          : [];
        if (!Number.isFinite(rowIndex) || rowIndex <= 0 || !sequence.length) return null;
        return { rowIndex, sequence };
      })
      .filter(Boolean)
      .sort((a, b) => a.rowIndex - b.rowIndex);

    return normalized.length ? normalized : null;
  };

  const expandedSchemeResult = useMemo(
    () => aiResults.find((item) => Number(item?.missionId) === Number(expandedSchemeMissionId)) || null,
    [aiResults, expandedSchemeMissionId]
  );

  const expandedSchemeLayout = useMemo(() => {
    if (!expandedSchemeResult) return null;
    const { bushes, gaps } = buildMissionSchemePoints(expandedSchemeResult);
    const all = [
      ...bushes.map((p) => ({ ...p, kind: 'bush' })),
      ...gaps.map((p) => ({ ...p, kind: 'gap' })),
    ];
    const sequenceRows = buildRowsFromRowSequences(expandedSchemeResult);
    const rowsCount = sequenceRows?.length
      ? sequenceRows.length
      : Math.max(1, Number(expandedSchemeResult.rowsCount || 0) || 1);
    const rowHeight = 70;
    const startY = 50;
    const startX = 80;
    const mapWidth = 1000;
    const mapHeight = Math.max(600, startY + rowsCount * rowHeight + 40);

    let renderedRows = [];
    if (sequenceRows?.length) {
      renderedRows = sequenceRows.map((row) => row.sequence.map((kind) => ({ kind })));
    } else {
      renderedRows = Array.from({ length: rowsCount }, () => []);
      if (all.length) {
        const minY = Math.min(...all.map((p) => p.y));
        const maxY = Math.max(...all.map((p) => p.y));
        const spanY = Math.max(1e-9, maxY - minY);
        all.forEach((point) => {
          const rowIdx = Math.min(
            rowsCount - 1,
            Math.max(0, Math.floor(((point.y - minY) / spanY) * rowsCount))
          );
          renderedRows[rowIdx].push(point);
        });
      }
      renderedRows = renderedRows.map((row) => row.sort((a, b) => a.x - b.x));
    }
    const maxRowLength = Math.max(1, ...renderedRows.map((r) => r.length));
    const bushSpacing = Math.min(60, Math.max(25, 900 / maxRowLength));

    const renderedPoints = [];
    renderedRows.forEach((row, rowIdx) => {
      row.forEach((point, pointIdx) => {
        renderedPoints.push({
          x: startX + pointIdx * bushSpacing,
          y: startY + rowIdx * rowHeight + 5,
          kind: point.kind,
          row: rowIdx + 1,
          pos: pointIdx + 1,
        });
      });
    });

    const markerRadius = renderedPoints.length > 2500 ? 6 : renderedPoints.length > 1200 ? 8 : 10;
    const markerOpacity = renderedPoints.length > 2500 ? 0.7 : 0.85;

    return {
      rowsCount,
      rowHeight,
      startY,
      startX,
      mapWidth,
      mapHeight,
      renderedPoints,
      markerRadius,
      markerOpacity,
    };
  }, [expandedSchemeResult]);

  useEffect(() => {
    if (!expandedSchemeLayout) return;
    if (!expandedSchemeMissionId) return;
    if (!expandedCanvasRef.current || !expandedCanvasWrapRef.current) return;

    const canvas = expandedCanvasRef.current;
    const wrap = expandedCanvasWrapRef.current;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const cssW = Math.max(1, wrap.clientWidth || 1);
      const cssH = Math.max(1, wrap.clientHeight || 1);
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

      const nextW = Math.floor(cssW * dpr);
      const nextH = Math.floor(cssH * dpr);
      if (canvas.width !== nextW) canvas.width = nextW;
      if (canvas.height !== nextH) canvas.height = nextH;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      // Background
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, cssW, cssH);

      const vb = expandedViewBox;
      const scaleX = cssW / vb.width;
      const scaleY = cssH / vb.height;

      const toScreen = (wx, wy) => ({
        x: (wx - vb.x) * scaleX,
        y: (wy - vb.y) * scaleY,
      });

      // Grid (world units: 10 + 50, anchored at 0)
      const drawGrid = (step, color, lineWidth) => {
        const startX = Math.floor(vb.x / step) * step;
        const endX = vb.x + vb.width;
        const startY = Math.floor(vb.y / step) * step;
        const endY = vb.y + vb.height;
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        for (let x = startX; x <= endX; x += step) {
          const p1 = toScreen(x, vb.y);
          const p2 = toScreen(x, vb.y + vb.height);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
        for (let y = startY; y <= endY; y += step) {
          const p1 = toScreen(vb.x, y);
          const p2 = toScreen(vb.x + vb.width, y);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
        ctx.stroke();
      };

      drawGrid(10, '#e2e8f0', 0.5);
      drawGrid(50, '#cbd5e1', 1);

      // Rows (dashed)
      ctx.save();
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([6, 4]);
      for (let idx = 0; idx < expandedSchemeLayout.rowsCount; idx += 1) {
        const y = expandedSchemeLayout.startY + idx * expandedSchemeLayout.rowHeight + 5;
        const a = toScreen(70, y);
        const b = toScreen(960, y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();

      // Points (only those in current viewBox)
      const { renderedPoints, markerRadius, markerOpacity } = expandedSchemeLayout;
      const r = markerRadius;

      // Quick cull bounds in world coords
      const minX = vb.x - r;
      const maxX = vb.x + vb.width + r;
      const minY = vb.y - r;
      const maxY = vb.y + vb.height + r;

      for (let i = 0; i < renderedPoints.length; i += 1) {
        const p = renderedPoints[i];
        if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
        const s = toScreen(p.x, p.y);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * Math.min(scaleX, scaleY), 0, Math.PI * 2);
        if (p.kind === 'bush') {
          ctx.fillStyle = `rgba(16,185,129,${markerOpacity})`;
          ctx.strokeStyle = '#059669';
        } else {
          ctx.fillStyle = `rgba(254,202,202,${Math.min(1, markerOpacity + 0.1)})`;
          ctx.strokeStyle = '#ef4444';
        }
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      }
    };

    const schedule = () => {
      if (expandedDrawRafRef.current != null) return;
      expandedDrawRafRef.current = requestAnimationFrame(() => {
        expandedDrawRafRef.current = null;
        draw();
      });
    };

    schedule();
    const ro = new ResizeObserver(() => schedule());
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      if (expandedDrawRafRef.current != null) {
        cancelAnimationFrame(expandedDrawRafRef.current);
        expandedDrawRafRef.current = null;
      }
    };
  }, [expandedSchemeLayout, expandedSchemeMissionId, expandedViewBox]);

  const applyExpandedZoom = (factor) => {
    setExpandedViewBox((prev) => {
      const cx = prev.x + prev.width / 2;
      const cy = prev.y + prev.height / 2;
      const nextWidth = Math.min(5000, Math.max(160, prev.width / factor));
      const nextHeight = Math.min(5000, Math.max(100, prev.height / factor));
      return {
        x: cx - nextWidth / 2,
        y: cy - nextHeight / 2,
        width: nextWidth,
        height: nextHeight,
      };
    });
  };
  const zoomInExpandedScheme = () => applyExpandedZoom(1.2);
  const zoomOutExpandedScheme = () => applyExpandedZoom(1 / 1.2);
  const resetExpandedSchemeZoom = () => setExpandedViewBox({ x: 0, y: 0, width: 1000, height: 600 });
  const closeExpandedScheme = () => {
    setExpandedSchemeMissionId(null);
    setExpandedViewBox({ x: 0, y: 0, width: 1000, height: 600 });
    setIsExpandedPanning(false);
    setExpandedPanStart(null);
    expandedPanLatestRef.current = null;
    if (expandedPanRafRef.current != null) {
      cancelAnimationFrame(expandedPanRafRef.current);
      expandedPanRafRef.current = null;
    }
    if (expandedDrawRafRef.current != null) {
      cancelAnimationFrame(expandedDrawRafRef.current);
      expandedDrawRafRef.current = null;
    }
  };
  const openExpandedScheme = (missionId) => {
    setExpandedSchemeMissionId(missionId);
    setExpandedViewBox({ x: 0, y: 0, width: 1000, height: 600 });
    setIsExpandedPanning(false);
    setExpandedPanStart(null);
    expandedPanLatestRef.current = null;
    if (expandedPanRafRef.current != null) {
      cancelAnimationFrame(expandedPanRafRef.current);
      expandedPanRafRef.current = null;
    }
  };

  const canEnableRouteMode = Boolean(
    (workZoneReady || tourUiPreview) && selectedDrone && !selectedDrone.isFlying
  );

  const routeBuildTitle = isRouteEditMode
    ? 'Завершить редактирование маршрута'
    : !workZoneReady
      ? 'Сначала выберите или создайте зону с контуром на карте (меню зон слева или кнопка зоны справа)'
      : !selectedDrone
        ? 'Сначала выберите дрон в списке ниже'
        : selectedDrone.isFlying
          ? 'Во время полёта маршрут недоступен'
          : 'Включить режим: клики по карте внутри зоны добавляют точки маршрута';

  useEffect(() => {
    if (suspendAutoSelectDrone) return;
    if (!selectedDroneId && visibleDrones.length > 0 && onSelectDrone) {
      onSelectDrone(visibleDrones[0].id);
    }
  }, [selectedDroneId, visibleDrones, onSelectDrone, suspendAutoSelectDrone]);

  useEffect(() => {
    if (instructionTourActive) setActiveTab('control');
  }, [instructionTourActive]);

  return (
    <>
    <div className="w-full lg:w-80 bg-gray-800/95 lg:bg-gray-800/85 border border-gray-700/70 backdrop-blur-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col h-full">
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 p-4 border-b border-gray-700/80">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 flex justify-center items-center relative">
            <h2 className="text-xl font-bold text-white mx-auto">Панель управления</h2>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 absolute right-0"
                style={{ top: 0, bottom: 0 }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
     
        </div>
      </div>
      <div className="flex border-b border-gray-700">
        <button
          className={`flex-1 py-3 min-h-[44px] text-center font-medium transition-colors ${activeTab === 'control'
            ? 'bg-gray-700/90 text-blue-300 border-b-2 border-blue-400'
            : 'bg-gray-800/70 text-gray-400 hover:bg-gray-700/80 hover:text-gray-200'
            }`}
          onClick={() => setActiveTab('control')}
        >
          Управление
        </button>
        <button
          className={`flex-1 py-3 min-h-[44px] text-center font-medium transition-colors ${activeTab === 'logs'
            ? 'bg-gray-700/90 text-blue-300 border-b-2 border-blue-400'
            : 'bg-gray-800/70 text-gray-400 hover:bg-gray-700/80 hover:text-gray-200'
            }`}
          onClick={() => setActiveTab('logs')}
        >
          Логи
          {missionLog.length > 0 && (
            <span className="ml-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
              {missionLog.length}
            </span>
          )}
        </button>
        <button
          className={`flex-1 py-3 min-h-[44px] text-center font-medium transition-colors ${activeTab === 'bushes'
            ? 'bg-gray-700/90 text-emerald-300 border-b-2 border-emerald-400'
            : 'bg-gray-800/70 text-gray-400 hover:bg-gray-700/80 hover:text-gray-200'
            }`}
          onClick={() => setActiveTab('bushes')}
        >
          Результаты
          {aiResults.length > 0 && (
            <span className="ml-2 bg-emerald-600 text-white text-xs px-2 py-1 rounded-full">
              {aiResults.length}
            </span>
          )}
        </button>
      </div>
      <div className={`flex-1 p-4 ${activeTab === 'control' ? 'overflow-y-auto' : 'min-h-0 overflow-hidden'}`}>
        {activeTab === 'control' && (
          <div className="space-y-4">
            {listForPicker.length === 0 && (
              <div className="text-center py-10 text-gray-400">
                <div className="text-4xl mb-3">🛸</div>
                <p className="text-base">Нет дронов на карте</p>
              </div>
            )}
            {listForPicker.length > 0 && (
              <div className="space-y-2">
                {listForPicker.map((drone) => (
                <div
                  key={drone.id}
                  className={`p-3 rounded-lg transition-all duration-200
                    ${selectedDrone?.id === drone.id
                      ? 'ring-2 ring-blue-300 border border-blue-500/40 bg-blue-900/35 shadow-sm'
                      : 'bg-gray-900/45 border border-gray-700/60 hover:bg-gray-800/60 hover:border-gray-600'
                    } ${isTourDemoDrone(drone) ? 'cursor-default' : 'cursor-pointer'}`}
                  onClick={() => {
                    if (!isTourDemoDrone(drone)) onSelectDrone(drone.id);
                  }}
                >
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${
                        selectedDrone?.id === drone.id
                          ? 'bg-blue-400' 
                          : drone.isFlying 
                            ? 'bg-green-400 animate-pulse' 
                            : 'bg-gray-500'
                      }`}></div>
                      <div>
                        <h4 className="font-bold text-white">{drone.name}</h4>
                        <p className="text-xs text-gray-300">{getStatusText(drone)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${drone.battery < 30 ? 'text-red-400' : 'text-green-400'}`}>
                        {drone.battery}%
                      </div>
                      <div className="text-xs text-gray-400">Батарея</div>
                    </div>
                  </div>
                  {drone.isFlying && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-gray-300 mb-1">
                        <span>Прогресс:</span>
                        <span>{Math.round(drone.flightProgress || 0)}%</span>
                      </div>
                      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${getProgressColor(drone.flightProgress)} transition-all duration-300 ease-out`}
                          style={{ width: `${drone.flightProgress || 0}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                ))}
              </div>
            )}
            {selectedDrone && (
              <div
                className={`border-t border-gray-700 pt-4 ${tourUiPreview ? 'pointer-events-none select-none' : ''}`}
              >
                {tourUiPreview && (
                  <p className="mb-2 rounded-lg border border-blue-500/40 bg-blue-950/50 px-2 py-1.5 text-center text-[11px] text-blue-200/95">
                    Пример интерфейса тура — кнопки не выполняют действия
                  </p>
                )}
                <h3 className="text-lg font-semibold text-white mb-3">
                  Управление: {selectedDrone.name}
                </h3>
                <div className={`p-3 rounded-lg border ${getStatusColor(selectedDrone)} mb-4`}>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-gray-400">Статус:</div>
                    <div className="font-medium text-white">{getStatusText(selectedDrone)}</div>

                    <div className="text-gray-400">Точек маршрута:</div>
                    <div className="font-medium text-white">{selectedDronePathLength}</div>

                    <div className="text-gray-400">Общая дистанция:</div>
                    <div className="font-medium text-white">
                      {selectedDrone.missionParameters?.totalDistance || 0} м
                    </div>

                    <div className="text-gray-400">Оцен. время:</div>
                    <div className="font-medium text-white">
                      {formatTimeSeconds(estimatedTimeSec ?? selectedDrone.missionParameters?.estimatedTime)}
                      <span className="text-gray-500 text-xs font-normal ml-1">(мин:сек)</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="font-semibold text-white">Маршрутизация</h4>

                  {!selectedDrone.isFlying && (
                    <>
                      <div className="flex gap-2 mb-3">
                        <button
                          type="button"
                          data-onboarding="route-build"
                          onClick={onToggleRouteMode}
                          disabled={!isRouteEditMode && !canEnableRouteMode}
                          title={routeBuildTitle}
                          aria-disabled={!isRouteEditMode && !canEnableRouteMode}
                          className={`flex-1 py-2 min-h-[44px] rounded transition-colors ${
                            isRouteEditMode
                              ? 'bg-blue-600 hover:bg-blue-700 text-white'
                              : canEnableRouteMode
                                ? 'bg-blue-700 hover:bg-blue-600 text-white'
                                : 'bg-gray-700 text-gray-400 cursor-not-allowed opacity-80'
                          }`}
                        >
                          {isRouteEditMode ? 'Закончить маршрут' : 'Построить маршрут'}
                        </button>
                        <button
                          onClick={() => onDroneClick(selectedDrone)}
                          className="px-4 py-2 min-h-[44px] bg-purple-600 hover:bg-purple-700 rounded transition-colors"
                          title="Подробности"
                        >
                          ℹ️
                        </button>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => onUndoLastPoint(selectedDrone.id)}
                          disabled={!selectedDrone.path?.length}
                          className={`flex-1 py-2 rounded transition-colors ${selectedDrone.path?.length
                            ? 'bg-yellow-600 hover:bg-yellow-700'
                            : 'bg-gray-700 cursor-not-allowed opacity-50'
                            }`}
                          title="Отменить последнюю точку"
                          aria-label="Отменить последнюю точку"
                        >
                          <span className="inline-flex items-center justify-center" aria-hidden="true">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                          </span>
                        </button>
                        <button
                          onClick={() => onClearRoute(selectedDrone.id)}
                          disabled={!selectedDrone.path?.length}
                          className={`flex-1 py-2 rounded transition-colors ${selectedDrone.path?.length
                            ? 'bg-red-600 hover:bg-red-700'
                            : 'bg-gray-700 cursor-not-allowed opacity-50'
                            }`}
                          title="Очистить маршрут"
                          aria-label="Очистить маршрут"
                        >
                          <span className="inline-flex items-center justify-center" aria-hidden="true">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </span>
                        </button>
                      </div>

                  
                    </>
                  )}
                  <button
                    onClick={() => onFlyToFirstWaypoint?.(selectedDrone.id)}
                    disabled={!selectedDrone.path?.length || selectedDrone.isFlying}
                    className={`w-full mt-2 py-2 min-h-[44px] rounded transition-colors flex items-center justify-center gap-2 ${selectedDrone.path?.length && !selectedDrone.isFlying
                      ? 'bg-blue-600 hover:bg-blue-700'
                      : 'bg-gray-700 cursor-not-allowed opacity-50'
                      }`}
                    title={selectedDrone.isFlying ? 'Дождитесь окончания полёта' : 'Перелететь к первой точке миссии и остановиться'}
                  >
                    📍 К первой точке миссии
                  </button>
                  {!flightAllowedByWeather && weatherFlightReasons.length > 0 && !tourUiPreview && (
                    <div className="mt-2 px-3 py-2 rounded-lg bg-amber-900/40 border border-amber-600 text-amber-200 text-xs">
                      ⚠️ Неблагоприятные условия для полёта: {weatherFlightReasons.join(', ')}
                    </div>
                  )}
                  <div className="mt-4" data-onboarding="mission-first-waypoint">
                    <h4 className="font-semibold text-white mb-2">Управление полетом</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {selectedDroneStatus === flightStatus.IDLE && selectedDronePathLength >= 2 && (
                        <>
                          
                          <button
                            type="button"
                            onClick={() => onStartFlight(selectedDrone.id)}
                            disabled={!atMissionStart}
                            title={
                              atMissionStart
                                ? 'Запустить миссию'
                                : 'Миссия стартует только с первой точки маршрута — подведите дрон в радиус ~10 м от неё'
                            }
                            className={`col-span-2 py-2 min-h-[44px] rounded flex items-center justify-center gap-2 ${
                              atMissionStart
                                ? 'bg-green-600 hover:bg-green-700'
                                : 'cursor-not-allowed bg-gray-600 opacity-50'
                            }`}
                          >
                            🚀 Начать миссию
                          </button>
                        </>
                      )}
                      {selectedDroneStatus === flightStatus.FLYING && (
                        <>
                          <button
                            onClick={() => onPauseFlight(selectedDrone.id)}
                            className="bg-yellow-600 hover:bg-yellow-700 py-2 rounded flex items-center justify-center gap-2"
                          >⏸️ Пауза</button>
                          <button
                            onClick={() => onStopFlight(selectedDrone.id)}
                            className="bg-red-600 hover:bg-red-700 py-2 rounded flex items-center justify-center gap-2"
                          >⏹️ Стоп</button>
                        </>
                      )}
                      {selectedDroneStatus === flightStatus.PAUSED && (
                        <>
                          <button
                            onClick={() => onResumeFlight(selectedDrone.id)}
                            className="bg-green-600 hover:bg-green-700 py-2 rounded flex items-center justify-center gap-2"
                          >▶️ Продолжить</button>
                          <button
                            onClick={() => onStopFlight(selectedDrone.id)}
                            className="bg-red-600 hover:bg-red-700 py-2 rounded flex items-center justify-center gap-2"
                          >⏹️ Стоп</button>
                        </>
                      )}
                      {(selectedDroneStatus === flightStatus.TAKEOFF || selectedDroneStatus === flightStatus.LANDING) && (
                        <button
                          disabled
                          className="col-span-2 bg-gray-600 py-2 rounded cursor-not-allowed opacity-50 flex items-center justify-center gap-2"
                        >
                          ⏳ {selectedDroneStatus === flightStatus.TAKEOFF ? 'Взлетает...' : 'Садится...'}
                        </button>
                      )}
                      {selectedDroneStatus === flightStatus.COMPLETED && (
                        <>
                          <div className="col-span-2 text-center text-sm text-green-300">✅ Миссия завершена</div>
                        </>
                      )}
                      {selectedDroneStatus === flightStatus.IDLE && selectedDronePathLength < 2 && (
                        <div className="col-span-2 bg-yellow-900/50 border border-yellow-700 rounded p-2 text-center text-yellow-200 text-sm">
                          Для запуска полета добавьте минимум 2 точки маршрута
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="h-full min-h-0 flex flex-col gap-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-white">Журнал событий</h3>
              {missionLog.length > 0 && (
                <button
                  onClick={onClearLogs}
                  className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors"
                >
                  Очистить
                </button>
              )}
            </div>

            {missionLog.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center py-8 text-gray-500">
                <div className="text-4xl mb-2">📝</div>
                <p>Журнал событий пуст</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-2">
                {missionLog.map((log, index) => (
                  <div
                    key={`${log.id}-${index}`}
                    className="bg-gray-900/50 rounded-lg p-3 border-l-4 border-blue-500 hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{log.message.match(/^[^\s]+\s/)?.[0] || '📋'}</span>
                        <span className="font-medium text-white">{log.droneName}</span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 mb-1">{log.message.replace(/^[^\s]+\s/, '')}</p>
                    {log.data && Object.keys(log.data).length > 0 && (
                      <div className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-700">
                        {Object.entries(log.data).map(([key, value]) => (
                          <div key={key} className="flex justify-between">
                            <span>{key}:</span>
                            <span className="text-gray-300">{value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'bushes' && (
          <div className="h-full min-h-0 flex flex-col gap-4">
            <div className="flex justify-between items-center mb-1">
              <h3 className="text-lg font-semibold text-white">Результаты Миссий</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onDeleteAllAiMissionResults?.()}
                  disabled={!aiResults.length}
                  aria-label="Удалить результаты всех миссий"
                  className={`rounded px-2 py-1 text-xs transition-colors ${
                    aiResults.length
                      ? 'bg-red-700/80 text-red-100 hover:bg-red-600'
                      : 'cursor-not-allowed bg-gray-700/70 text-gray-400'
                  }`}
                  title={aiResults.length ? 'Удалить результаты всех миссий' : 'Нет результатов для удаления'}
                >
                  ✕
                </button>
              </div>
            </div>

            {aiResults.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center py-8 text-gray-500">
                <div className="text-4xl mb-2">☁️</div>
                <p>Пока нет результатов анализа</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-2">
                {aiResults.map((result) => (
                  <div
                    key={`${result.missionId}-${result.updatedAt ?? result.createdAt ?? 'unknown'}`}
                    role={typeof onOpenAiMission === 'function' ? 'button' : undefined}
                    tabIndex={typeof onOpenAiMission === 'function' ? 0 : undefined}
                    onClick={() => {
                      setSelectedAiMissionId((prev) => (prev === result.missionId ? null : result.missionId));
                      onOpenAiMission?.(result.missionId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedAiMissionId((prev) => (prev === result.missionId ? null : result.missionId));
                        onOpenAiMission?.(result.missionId);
                      }
                    }}
                    className={`rounded-lg border border-emerald-800/70 bg-emerald-950/25 p-3 transition-colors ${
                      typeof onOpenAiMission === 'function'
                        ? 'cursor-pointer hover:bg-emerald-900/35 focus:outline-none focus:ring-2 focus:ring-emerald-400/70'
                        : ''
                    }`}
                    title={typeof onOpenAiMission === 'function' ? `Открыть схему участка миссии #${result.missionId}` : undefined}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-emerald-200">
                          Миссия #{result.missionId}
                        </p>
                        <p className="text-xs text-gray-400">
                          {result.droneName ? `Дрон: ${result.droneName}` : 'Дрон не определён'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteAiMissionResult?.(result.missionId);
                        }}
                        aria-label={`Удалить результат миссии #${result.missionId}`}
                        className="rounded px-2 py-1 text-xs bg-red-700/80 text-red-100 hover:bg-red-600 transition-colors"
                        title={`Удалить результат миссии #${result.missionId}`}
                      >
                        ✕
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded bg-gray-900/50 px-2 py-1.5">
                        <p className="text-[11px] text-gray-400">Кустов</p>
                        <p className="font-semibold text-white">{result.bushesCount}</p>
                      </div>
                      <div className="rounded bg-gray-900/50 px-2 py-1.5">
                        <p className="text-[11px] text-gray-400">Пропусков</p>
                        <p className="font-semibold text-white">{result.gapsCount}</p>
                      </div>
                    </div>
                    {selectedAiMissionId === result.missionId && (() => {
                      const { bushes, gaps } = buildMissionSchemePoints(result);
                      const all = [...bushes, ...gaps];
                      if (!all.length) {
                        const rowsCount = Number(result?.rowsCount ?? 0);
                        if (rowsCount > 0) {
                          const w = 240;
                          const h = 140;
                          const topPad = 20;
                          const bottomPad = 16;
                          const usableH = Math.max(16, h - topPad - bottomPad);
                          const rowStep = usableH / rowsCount;
                          return (
                            <div className="mt-3 rounded border border-emerald-700/40 bg-gray-900/60 p-2">
                              <svg viewBox={`0 0 ${w} ${h}`} className="h-[140px] w-full rounded bg-gray-950/80">
                                <rect x="0" y="0" width={w} height={h} fill="transparent" stroke="rgba(75,85,99,0.55)" />
                                {Array.from({ length: rowsCount }).map((_, idx) => {
                                  const y = topPad + rowStep * (idx + 0.5);
                                  return (
                                    <g key={`row-${idx}`}>
                                      <line
                                        x1="16"
                                        y1={y}
                                        x2={w - 16}
                                        y2={y}
                                        stroke="rgba(148,163,184,0.7)"
                                        strokeDasharray="4 4"
                                        strokeWidth="1"
                                      />
                                      <text x="20" y={y - 4} fill="rgba(203,213,225,0.9)" fontSize="8">
                                        {`Ряд ${idx + 1}`}
                                      </text>
                                      <text x={w / 2 - 18} y={y + 3} fill="rgba(148,163,184,0.8)" fontSize="7">
                                        Нет данных
                                      </text>
                                    </g>
                                  );
                                })}
                              </svg>
                            </div>
                          );
                        }
                        return (
                          <div className="mt-3 rounded border border-gray-700/70 bg-gray-900/50 px-3 py-2 text-xs text-gray-400">
                            Схема участка от VineyardApp пока не содержит координат рядов для этой миссии.
                          </div>
                        );
                      }
                      const sequenceRows = buildRowsFromRowSequences(result);
                      const rowsCount = sequenceRows?.length
                        ? sequenceRows.length
                        : Math.max(1, Number(result.rowsCount || 0) || 1);
                      const rowHeight = 70;
                      const startY = 50;
                      const startX = 80;
                      const mapWidth = 1000;
                      const mapHeight = Math.max(380, startY + rowsCount * rowHeight + 35);
                      let rows = [];
                      if (sequenceRows?.length) {
                        rows = sequenceRows.map((row) =>
                          row.sequence.map((kind) => ({ kind }))
                        );
                      } else {
                        const points = [
                          ...bushes.map((p) => ({ ...p, kind: 'bush' })),
                          ...gaps.map((p) => ({ ...p, kind: 'gap' })),
                        ];
                        rows = Array.from({ length: rowsCount }, () => []);
                        if (points.length) {
                          const minY = Math.min(...points.map((p) => p.y));
                          const maxY = Math.max(...points.map((p) => p.y));
                          const spanY = Math.max(1e-9, maxY - minY);
                          points.forEach((point) => {
                            const rowIdx = Math.min(
                              rowsCount - 1,
                              Math.max(0, Math.floor(((point.y - minY) / spanY) * rowsCount))
                            );
                            rows[rowIdx].push(point);
                          });
                        }
                        rows = rows.map((row) => row.sort((a, b) => a.x - b.x));
                      }
                      const maxRowLength = Math.max(1, ...rows.map((r) => r.length));
                      const bushSpacing = Math.min(60, Math.max(25, 900 / maxRowLength));
                      const renderedPoints = [];
                      rows.forEach((row, rowIdx) => {
                        row.forEach((point, pointIdx) => {
                          renderedPoints.push({
                            x: startX + pointIdx * bushSpacing,
                            y: startY + rowIdx * rowHeight + 5,
                            kind: point.kind,
                          });
                        });
                      });
                      const pointCount = renderedPoints.length;
                      const pointRadius = pointCount > 2500 ? 3.2 : pointCount > 1200 ? 3.6 : 4.2;
                      return (
                        <div className="mt-3 rounded border border-emerald-700/40 bg-gray-900/60 p-2">
                          <div className="mb-1 flex items-center justify-between text-[11px] text-gray-300">
                            <span>Схема участка</span>
                            <span>ряды: {result.rowsCount || '—'} · точек: {pointCount}</span>
                          </div>
                          <svg
                            viewBox={`0 0 ${mapWidth} ${mapHeight}`}
                            className="h-[140px] w-full rounded bg-gray-50 cursor-zoom-in transition hover:ring-1 hover:ring-emerald-400/50"
                            onClick={() => openExpandedScheme(result.missionId)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openExpandedScheme(result.missionId);
                              }
                            }}
                            title="Открыть схему на весь экран"
                          >
                            <defs>
                              <pattern id={`mini-grid-main-${result.missionId}`} patternUnits="userSpaceOnUse" width="50" height="50">
                                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#cbd5e1" strokeWidth="1" />
                              </pattern>
                              <pattern id={`mini-grid-fine-${result.missionId}`} patternUnits="userSpaceOnUse" width="10" height="10">
                                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#e2e8f0" strokeWidth="0.5" />
                              </pattern>
                            </defs>
                            <rect x="-5000" y="-5000" width="10000" height="10000" fill={`url(#mini-grid-fine-${result.missionId})`} />
                            <rect x="-5000" y="-5000" width="10000" height="10000" fill={`url(#mini-grid-main-${result.missionId})`} />
                            {Array.from({ length: rowsCount }).map((_, idx) => {
                              const y = startY + idx * rowHeight + 5;
                              return (
                                <g key={`mini-row-${idx}`}>
                                  <text x="22" y={y + 6} fill="#374151" fontSize="12" fontWeight="bold">{`Р${idx + 1}`}</text>
                                  <line x1="70" y1={y} x2="960" y2={y} stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="6 4" />
                                </g>
                              );
                            })}
                            {renderedPoints.map((point, i) =>
                              point.kind === 'bush' ? (
                                <circle key={`mini-b-${i}`} cx={point.x} cy={point.y} r={pointRadius} fill="#10b981" fillOpacity="0.85" stroke="#059669" strokeWidth="1.2" />
                              ) : (
                                <circle key={`mini-g-${i}`} cx={point.x} cy={point.y} r={pointRadius} fill="#fecaca" fillOpacity="0.95" stroke="#ef4444" strokeWidth="1.2" />
                              )
                            )}
                          </svg>
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-400">
                            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />Кусты</span>
                            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-400" />Пропуски</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="p-3 bg-gray-900 border-t border-gray-700">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="p-2 bg-gray-800/50 rounded">
            <div className="text-lg font-bold text-white">{visibleDrones.length}</div>
            <div className="text-xs text-gray-400">На карте</div>
          </div>
          <div className="p-2 bg-gray-800/50 rounded">
            <div className="text-lg font-bold text-green-400">{flyingDrones.length}</div>
            <div className="text-xs text-gray-400">В полете</div>
          </div>
        </div>
      </div>
    </div>
    {expandedSchemeResult && (() => {
      const layout = expandedSchemeLayout;
      if (!layout) return null;
      const { rowsCount, rowHeight, startY, renderedPoints, markerRadius, markerOpacity } = layout;
      const zoomPercent = Math.round((1000 / expandedViewBox.width) * 100);

      const onExpandedMouseDown = (e) => {
        setIsExpandedPanning(true);
        setExpandedPanStart({ x: e.clientX, y: e.clientY, vb: expandedViewBox });
      };
      const onExpandedMouseMove = (e) => {
        if (!isExpandedPanning || !expandedPanStart) return;
        expandedPanLatestRef.current = { x: e.clientX, y: e.clientY };
        if (expandedPanRafRef.current != null) return;
        expandedPanRafRef.current = requestAnimationFrame(() => {
          expandedPanRafRef.current = null;
          const latest = expandedPanLatestRef.current;
          if (!latest) return;
          setExpandedViewBox((prev) => {
            const base = expandedPanStart?.vb ?? prev;
            const dx = latest.x - expandedPanStart.x;
            const dy = latest.y - expandedPanStart.y;
            const scaleX = base.width / 1000;
            const scaleY = base.height / 600;
            return {
              x: base.x - dx * scaleX,
              y: base.y - dy * scaleY,
              width: base.width,
              height: base.height,
            };
          });
        });
      };
      const onExpandedMouseUp = () => {
        setIsExpandedPanning(false);
        setExpandedPanStart(null);
        expandedPanLatestRef.current = null;
        if (expandedPanRafRef.current != null) {
          cancelAnimationFrame(expandedPanRafRef.current);
          expandedPanRafRef.current = null;
        }
      };
      const onExpandedWheel = (e) => {
        e.preventDefault();
        if (e.deltaY < 0) zoomInExpandedScheme();
        else zoomOutExpandedScheme();
      };

      const overlay = (
        <div className="fixed inset-0 z-[120] flex h-screen w-screen flex-col bg-gray-950">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-700 bg-gray-900/95 px-3 py-2 sm:px-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-emerald-300">
                  Схема миссии #{expandedSchemeResult.missionId}
                </p>
                <p className="truncate text-xs text-gray-400">
                  Ряды: {expandedSchemeResult.rowsCount || '—'} · кустов: {expandedSchemeResult.bushesCount} · пропусков: {expandedSchemeResult.gapsCount}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={zoomOutExpandedScheme} className="rounded bg-gray-800 px-2.5 py-1 text-sm text-gray-100 hover:bg-gray-700" title="Уменьшить">−</button>
                <button type="button" onClick={resetExpandedSchemeZoom} className="rounded bg-gray-800 px-2.5 py-1 text-xs text-gray-100 hover:bg-gray-700" title="Сбросить масштаб">{zoomPercent}%</button>
                <button type="button" onClick={zoomInExpandedScheme} className="rounded bg-gray-800 px-2.5 py-1 text-sm text-gray-100 hover:bg-gray-700" title="Увеличить">+</button>
                <button
                  type="button"
                  onClick={closeExpandedScheme}
                  aria-label="Закрыть схему"
                  title="Закрыть"
                  className="rounded bg-red-700/80 px-2.5 py-1 text-base font-semibold leading-none text-red-100 hover:bg-red-600"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {!renderedPoints.length ? (
                <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
                  Нет координат рядов для отображения.
                </div>
              ) : (
                <div
                  ref={expandedCanvasWrapRef}
                  className="h-full w-full bg-gray-50"
                  onMouseDown={onExpandedMouseDown}
                  onMouseMove={onExpandedMouseMove}
                  onMouseUp={onExpandedMouseUp}
                  onMouseLeave={onExpandedMouseUp}
                  onWheel={onExpandedWheel}
                  style={{ cursor: isExpandedPanning ? 'grabbing' : 'grab' }}
                >
                  <canvas ref={expandedCanvasRef} className="block h-full w-full" />
                </div>
              )}
            </div>
        </div>
      );
      if (typeof document !== 'undefined' && document.body) {
        return createPortal(overlay, document.body);
      }
      return overlay;
    })()}
    </>
  );
};
