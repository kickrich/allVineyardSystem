import { useState, useRef, useEffect } from 'react';

export function ZoneMapMenu({
  zones,
  activeZoneId,
  onSelectZone,
  className = '',
  showEmptyMenuDuringTour = false,
}) {
  const [open, setOpen] = useState(false);
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

  if (!hasZones && !showEmptyMenuDuringTour) return null;

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
              return (
                <li key={z.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectZone(z.id);
                      setOpen(false);
                    }}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'bg-emerald-700/50 text-white ring-1 ring-emerald-400/60'
                        : 'text-gray-100 hover:bg-gray-800'
                    }`}
                  >
                    <span className="truncate">{z.name || `Зона ${z.id}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
