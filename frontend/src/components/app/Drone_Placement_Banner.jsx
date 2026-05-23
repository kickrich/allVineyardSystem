export function Drone_Placement_Banner({ droneLabel, onCancel }) {
  return (
    <div
      className="pointer-events-auto absolute bottom-3 left-1/2 z-[200] w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border border-yellow-500/70 bg-yellow-950/90 px-3 py-2.5 shadow-xl backdrop-blur-sm sm:bottom-4"
      style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-yellow-100 leading-snug">
          Кликните внутри контура активной зоны на карте, чтобы поставить дрон
          {droneLabel}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 min-h-[40px]"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
