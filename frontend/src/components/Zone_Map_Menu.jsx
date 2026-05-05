import { useState, useRef, useEffect } from 'react';

export function ZoneMapMenu({
  zones,
  activeZoneId,
  onSelectZone,
  onDeleteZone,
  zoneTemplateUsageById = {},
  deleteBusy = false,
  className = '',
  showEmptyMenuDuringTour = false,
}) {
  const [open, setOpen] = useState(false);
  const [confirmDeleteZoneId, setConfirmDeleteZoneId] = useState(null);
  const rootRef = useRef(null);
  const hasZones = Array.isArray(zones) && zones.length > 0;
  const showEmptyPlaceholder = !hasZones && showEmptyMenuDuringTour;
  const emptyMenuSpotlight = showEmptyPlaceholder;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!confirmDeleteZoneId) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setConfirmDeleteZoneId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmDeleteZoneId]);

  if (!hasZones && !showEmptyMenuDuringTour) return null;

  const zoneForConfirmDelete =
    confirmDeleteZoneId != null
      ? zones?.find((z) => String(z?.id) === String(confirmDeleteZoneId)) ?? null
      : null;

  return (
    <div ref={rootRef} data-onboarding="zone-map-menu" className={`absolute top-2 left-2 z-[125] ${className}`}>
      <button
        type="button"
        aria-label={open ? 'Закрыть список зон' : hasZones ? 'Выбрать зону' : 'Меню зон (пока пусто)'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-11 w-11 items-center justify-center rounded-lg border bg-gray-900/90 text-white shadow-lg backdrop-blur-sm transition-colors duration-200 hover:bg-gray-800 ${
          emptyMenuSpotlight
            ? 'border-amber-400/90 ring-4 ring-amber-400 ring-offset-2 ring-offset-gray-950/90 shadow-[0_0_22px_rgba(251,191,36,0.45)]'
            : 'border-gray-600'
        }`}
      >
        <span className="flex h-5 w-5 flex-col justify-center gap-[5px]" aria-hidden>
          <span
            className={`block h-0.5 w-5 origin-center rounded-full bg-current transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              open ? 'translate-y-[7px] rotate-45' : ''
            }`}
          />
          <span
            className={`block h-0.5 w-5 origin-center rounded-full bg-current transition-opacity duration-200 ease-out ${
              open ? 'opacity-0' : ''
            }`}
          />
          <span
            className={`block h-0.5 w-5 origin-center rounded-full bg-current transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              open ? '-translate-y-[7px] -rotate-45' : ''
            }`}
          />
        </span>
      </button>
      <div
        className={`absolute left-0 top-[calc(100%+0.5rem)] z-10 max-h-[min(60vh,320px)] w-[min(82vw,280px)] origin-top-left overflow-y-auto rounded-xl border border-gray-600 bg-gray-900/95 p-2 shadow-xl backdrop-blur-sm transition-[opacity,transform] duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open
            ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none -translate-y-[0.4rem] scale-96 opacity-0'
        }`}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <p className="px-2 py-1 text-xs uppercase tracking-wide text-gray-400">Зоны</p>
        {!hasZones ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-950/35 px-3 py-2.5">
            <p className="text-sm leading-relaxed text-amber-50/95">
              Пока нет сохранённых зон. Создайте зону кнопкой{' '}
              <span className="whitespace-nowrap font-semibold text-white">▭</span> справа вверху на карте — после
              сохранения список зон появится здесь, и вы сможете выбрать активную зону для маршрута.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {zones.map((z) => {
              const active = z.id === activeZoneId;
              const usageCount = Number(zoneTemplateUsageById[String(z.id)] || 0);
              const deleteBlockedByTemplates = usageCount > 0;
              const deleteDisabled = deleteBusy || deleteBlockedByTemplates;
              return (
                <li key={z.id}>
                  <div
                    className={`flex items-center gap-1 rounded-lg p-1 ${
                      active ? 'bg-emerald-700/40 ring-1 ring-emerald-400/50' : 'hover:bg-gray-800/80'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelectZone(z.id);
                        setOpen(false);
                      }}
                      className="flex-1 rounded-md px-2 py-1.5 text-left text-sm text-gray-100"
                    >
                      <span className="truncate">{z.name || `Зона ${z.id}`}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteZoneId(z.id);
                      }}
                      disabled={deleteDisabled}
                      aria-label={`Удалить зону ${z.name || `ID ${z.id}`}`}
                      title={
                        deleteBlockedByTemplates
                          ? 'Зона связана с шаблонами: удаляйте через Shablone_screen'
                          : 'Удалить зону'
                      }
                      className={`h-8 w-8 shrink-0 rounded-md text-sm transition-colors ${
                        deleteDisabled
                          ? 'cursor-not-allowed bg-gray-700/70 text-gray-400'
                          : 'bg-red-700/80 text-red-100 hover:bg-red-600'
                      }`}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {confirmDeleteZoneId != null && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Подтверждение удаления зоны"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmDeleteZoneId(null);
          }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
          <div className="relative w-full max-w-md rounded-2xl border border-gray-600 bg-gray-950/95 p-4 text-white shadow-2xl">
            <h3 className="text-lg font-semibold">Удалить зону?</h3>
            <p className="mt-2 text-sm text-gray-300">
              Вы действительно хотите удалить{' '}
              <span className="font-semibold text-white">
                {zoneForConfirmDelete?.name || `зону ID ${confirmDeleteZoneId}`}
              </span>
              ?
            </p>
            <div className="mt-3 rounded-xl border border-red-500/40 bg-red-950/25 px-3 py-2 text-xs text-red-100">
              Это действие нельзя отменить. Обычные маршруты миссий внутри этой зоны (не шаблоны) будут удалены
              автоматически.
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteZoneId(null)}
                className="h-10 rounded-lg bg-gray-800 px-4 text-sm font-medium text-gray-100 hover:bg-gray-700"
              >
                Нет
              </button>
              <button
                type="button"
                disabled={deleteBusy}
                onClick={() => {
                  const zid = confirmDeleteZoneId;
                  setConfirmDeleteZoneId(null);
                  setOpen(false);
                  onDeleteZone?.(zid);
                }}
                className={`h-10 rounded-lg px-4 text-sm font-semibold ${
                  deleteBusy
                    ? 'cursor-not-allowed bg-red-900/60 text-red-200 opacity-70'
                    : 'bg-red-700 text-red-50 hover:bg-red-600'
                }`}
              >
                Да, удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
