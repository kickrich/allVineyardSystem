import { useState, useRef, useEffect } from 'react';

/**
 * Кнопка-«бургер» в углу карты: раскрывает список зон и переключает активную.
 */
export function ZoneMapMenu({ zones, activeZoneId, onSelectZone, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

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

  if (!zones?.length) return null;

  return (
    <div ref={rootRef} data-onboarding="zone-map-menu" className={`absolute top-2 left-2 z-[125] ${className}`}>
      <button
        type="button"
        aria-label={open ? 'Закрыть список зон' : 'Выбрать зону'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-gray-600 bg-gray-900/90 text-white shadow-lg backdrop-blur-sm transition-colors duration-200 hover:bg-gray-800"
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
                  {z.name || `Зона ${z.id}`}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
