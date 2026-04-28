import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const DroneParking = ({
  drones = [],
  onPlaceDrone,
  onRemoveDrone,
  onCreateDrone,
  onBackToTemplates,
  onClose,
}) => {
  const placedDrones = drones.filter((d) => d.isVisible);
  const availableDrones = drones.filter((d) => !d.isVisible);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newDroneName, setNewDroneName] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');

  const openCreateModal = useCallback(() => {
    const suffix = `${Date.now()}`.slice(-6);
    setNewDroneName(`Дрон ${suffix}`);
    setCreateError('');
    setCreateModalOpen(true);
  }, []);

  const closeCreateModal = useCallback(() => {
    if (createBusy) return;
    setCreateModalOpen(false);
    setCreateError('');
  }, [createBusy]);

  useEffect(() => {
    if (!createModalOpen || typeof document === 'undefined') return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeCreateModal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [createModalOpen, closeCreateModal]);

  const submitCreate = useCallback(async () => {
    if (!onCreateDrone || createBusy) return;
    setCreateError('');
    setCreateBusy(true);
    try {
      await onCreateDrone(newDroneName);
      setCreateModalOpen(false);
    } catch (e) {
      setCreateError(String(e?.message ?? e ?? 'Не удалось создать дрона'));
    } finally {
      setCreateBusy(false);
    }
  }, [onCreateDrone, newDroneName, createBusy]);

  const getStatusColor = (drone) => {
    if (!drone.isVisible) return 'bg-gray-900/45 border-gray-700/60';

    switch (drone.flightStatus) {
      case 'FLYING':
        return 'border-green-500 bg-green-900/20';
      case 'PAUSED':
        return 'border-yellow-500 bg-yellow-900/20';
      case 'TAKEOFF':
      case 'LANDING':
        return 'border-blue-500 bg-blue-900/20';
      case 'COMPLETED':
        return 'border-green-700 bg-green-900/20';
      default:
        return 'border-gray-500 bg-gray-900/20';
    }
  };

  const getStatusIcon = (drone) => {
    if (!drone.isVisible) return '📦';

    switch (drone.flightStatus) {
      case 'FLYING':
        return '🛫';
      case 'PAUSED':
        return '⏸️';
      case 'TAKEOFF':
      case 'LANDING':
        return '🚁';
      case 'COMPLETED':
        return '✅';
      default:
        return '🛸';
    }
  };

  const getStatusText = (drone) => {
    if (!drone.isVisible) return 'В ангаре';

    switch (drone.flightStatus) {
      case 'FLYING':
        return 'В полете';
      case 'PAUSED':
        return 'На паузе';
      case 'TAKEOFF':
        return 'Взлетает';
      case 'LANDING':
        return 'Садится';
      case 'COMPLETED':
        return 'Миссия завершена';
      default:
        return 'На земле';
    }
  };

  const createModal =
    createModalOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[2600] flex items-center justify-center bg-black/55 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-drone-title"
            onClick={closeCreateModal}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-gray-600 bg-gray-900 p-5 text-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="create-drone-title" className="text-lg font-bold text-white mb-1">
                Новый дрон
              </h2>
              <p className="text-sm text-gray-400 mb-4">Укажите имя — оно появится в стоянке и на карте.</p>
              <label className="block text-sm text-gray-300 mb-1" htmlFor="new-drone-name-input">
                Имя
              </label>
              <input
                id="new-drone-name-input"
                type="text"
                value={newDroneName}
                onChange={(e) => setNewDroneName(e.target.value)}
                maxLength={120}
                disabled={createBusy}
                className="w-full rounded-lg border border-gray-600 bg-gray-800 px-3 py-2.5 text-white placeholder-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 min-h-[44px]"
                placeholder="Например, Дрон-обзор"
                autoComplete="off"
              />
              {createError ? (
                <p className="mt-2 text-sm text-red-300" role="alert">
                  {createError}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={createBusy}
                  className="rounded-lg border border-gray-500 px-4 py-2.5 min-h-[44px] text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => void submitCreate()}
                  disabled={createBusy}
                  className="rounded-lg bg-blue-600 px-4 py-2.5 min-h-[44px] text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {createBusy ? 'Создание…' : 'Создать'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col lg:w-72">
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl bg-gray-800/95 lg:bg-gray-800/85 border border-gray-700/70 backdrop-blur-sm shadow-2xl">
        <div className="shrink-0 bg-gradient-to-r from-gray-800 to-gray-900 p-4 border-b border-gray-700/80">
          <div className="flex justify-between items-center gap-2">
            <h2 className="text-xl font-bold text-white leading-tight whitespace-nowrap min-w-0 truncate">
              Стоянка для дронов
            </h2>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <div className="bg-green-500 rounded-full w-2 h-2"></div>
            <span className="text-sm text-gray-300">
              Размещено: {placedDrones.length} из {drones.length}
            </span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pr-2 space-y-4 [scrollbar-gutter:stable]">
          {placedDrones.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-white mb-3">Размещенные дроны</h3>
              <div className="space-y-3">
                {placedDrones.map((drone) => (
                  <div
                    key={drone.id}
                    className={`border ${getStatusColor(drone)} rounded-lg p-3 transition-all duration-200 hover:bg-gray-800/60`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{getStatusIcon(drone)}</span>
                        <div>
                          <h4 className="font-bold text-white">{drone.name}</h4>
                        </div>
                      </div>
                      <button
                        onClick={() => onRemoveDrone(drone.id)}
                        className="text-red-400 hover:text-red-300 transition-colors p-1 hover:bg-red-900/30 rounded"
                        title="Убрать дрон с карты"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-1 text-xs mt-2">
                      <div className="text-gray-400">Скорость:</div>
                      <div className="font-medium text-white">{Math.round(drone.speed * 3.6)} км/ч</div>
                      <div className="text-gray-400">Высота:</div>
                      <div className="font-medium text-white">{Math.round(drone.altitude)} м</div>
                      <div className="text-gray-400">Точки маршрута:</div>
                      <div className="font-medium text-white">{drone.path?.length || 0}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {availableDrones.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-lg font-semibold text-white">Доступные дроны</h3>
                {onCreateDrone && (
                  <button
                    type="button"
                    onClick={openCreateModal}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 min-h-[44px] rounded text-sm transition-colors whitespace-nowrap shrink-0"
                    title="Создать дрона в backend и добавить в стоянку"
                  >
                    Создать
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {availableDrones.map((drone, idx) => (
                  <div
                    key={drone.id}
                    className="bg-gray-900/45 border border-gray-700/60 rounded-lg p-3 hover:bg-gray-800/60 transition-colors hover:border-gray-600"
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className="text-2xl">📦</div>
                        <div>
                          <h4 className="font-bold text-gray-300">{drone.name}</h4>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onPlaceDrone(drone.id)}
                        {...(idx === 0 ? { 'data-onboarding': 'place-drone' } : {})}
                        className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 min-h-[44px] rounded text-sm transition-colors hover:scale-105 flex items-center whitespace-nowrap shrink-0"
                        title="Разместить дрон на карте"
                      >
                        Разместить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {drones.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">🛸</div>
              <p>Нет доступных дронов</p>
              {onCreateDrone && (
                <button
                  type="button"
                  onClick={openCreateModal}
                  className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 min-h-[44px] rounded text-sm transition-colors"
                >
                  + Создать дрона
                </button>
              )}
            </div>
          )}
        </div>
        {onBackToTemplates && (
          <div className="shrink-0 border-t border-gray-700 bg-gray-800/95 p-4 pt-2 backdrop-blur-sm hidden lg:block">
            <button
              type="button"
              onClick={onBackToTemplates}
              className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Вернуться к шаблонам
            </button>
          </div>
        )}
      </div>
      {createModal}
    </div>
  );
};
