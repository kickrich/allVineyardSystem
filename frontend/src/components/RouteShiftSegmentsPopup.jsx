import { createPortal } from 'react-dom';

export function RouteShiftSegmentsPopup({
  open,
  onClose,
  segmentIndices,
  pathPointCount,
  onToggleSegment,
  onboardingDemoActive = false,
}) {
  if (!open || typeof document === 'undefined') return null;

  const list = Array.isArray(segmentIndices)
    ? [...new Set(segmentIndices.filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b)
    : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="route-shift-dialog-title"
        className="max-h-[min(70vh,540px)] w-full max-w-md overflow-hidden rounded-2xl border border-violet-500/45 bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-700/90 px-4 py-3">
          <div className="min-w-0 pr-2">
            <h2 id="route-shift-dialog-title" className="text-lg font-semibold text-white">
              Смещения между рядами
            </h2>
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-600 text-lg leading-none text-gray-200 hover:bg-gray-800"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="max-h-[min(52vh,440px)] overflow-y-auto px-4 py-3">
          {list.length === 0 && onboardingDemoActive ? (
            <div className="space-y-3 text-sm leading-relaxed text-gray-200">
              <p>
                На карте уже показан <strong className="text-amber-200">пример</strong>: четыре точки и три
                отрезка оранжевой пунктирной линией; <strong className="text-violet-200">средний отрезок</strong>{' '}
                подсвечен фиолетовым — это метка «смещение» (разворот между рядами). Так позже можно будет
                резать видео: примерно один ряд виноградника — один файл.
              </p>
              <p className="text-gray-400">
                У себя: нажмите «Построить маршрут», поставьте точки в зоне и кликните по линии нужного отрезка
                (не по кругу узла редактора), чтобы включить или снять такую же метку.
              </p>
            </div>
          ) : null}
          {list.length === 0 && !onboardingDemoActive ? (
            <p className="text-sm text-gray-400">
              Пока нет отмеченных отрезков. Кликните точно по оранжевой линии между точками (не по узлу
              редактора).
            </p>
          ) : null}
          {list.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {list.map((seg) => (
                <li
                  key={seg}
                  className="flex items-center justify-between gap-2 rounded-xl border border-violet-600/35 bg-violet-950/35 px-3 py-2.5"
                >
                  <span className="min-w-0 text-sm text-gray-100">
                    Отрезок{' '}
                    <span className="font-mono text-violet-200">
                      {seg + 1}→{seg + 2}
                    </span>
                    <span className="text-gray-500"> (точки маршрута {seg + 1} и {seg + 2})</span>
                  </span>
                  <button
                    type="button"
                    className="flex-shrink-0 rounded-lg border border-gray-500/80 px-2.5 py-1 text-xs font-medium text-gray-100 hover:bg-gray-800"
                    onClick={() => onToggleSegment(seg)}
                  >
                    Убрать
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex justify-between gap-2 border-t border-gray-700/90 px-4 py-3">
          <p className="self-center text-xs text-gray-500">
            Всего точек: <span className="text-gray-300">{pathPointCount}</span>
          </p>
          <button
            type="button"
            className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
