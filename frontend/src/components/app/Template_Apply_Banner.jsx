export function Template_Apply_Banner({ onCancel, onConfirm, confirmDisabled }) {
  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-1/2 z-[210] w-[min(92vw,520px)] -translate-x-1/2 rounded-xl border border-emerald-500/70 bg-emerald-950/90 px-3 py-2.5 shadow-xl backdrop-blur-sm sm:bottom-4"
      style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-emerald-100 leading-snug">
            Выберите дрона для этого маршрута.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg bg-gray-800/80 px-3 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700 min-h-[40px]"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px]"
            title={confirmDisabled ? 'Сначала выберите дрона в панели' : 'Применить шаблон к выбранному дрону'}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}
