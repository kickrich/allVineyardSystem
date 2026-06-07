export function Mobile_Workspace_Nav({
  onOpenParking,
  onBackToTemplates,
  onOpenSidebar,
}) {
  return (
    <div
      className="flex-shrink-0 flex justify-between items-center gap-2 lg:hidden pt-2"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0.5rem)' }}
    >
      <button
        type="button"
        onClick={onOpenParking}
        className="min-h-[48px] flex-1 min-w-0 px-3 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-xl shadow-lg text-white font-medium flex items-center justify-center gap-1.5"
      >
        <span>🛸</span>
        <span>Стоянка</span>
      </button>
      <button
        type="button"
        onClick={onBackToTemplates}
        className="min-h-[48px] flex-1 min-w-0 px-3 py-3 bg-amber-600 hover:bg-amber-500 rounded-xl shadow-lg text-white font-medium flex items-center justify-center gap-1.5"
      >
        <span>←</span>
        <span className="truncate">Назад</span>
      </button>
      <button
        type="button"
        onClick={onOpenSidebar}
        className="min-h-[48px] flex-1 min-w-0 px-3 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl shadow-lg text-white font-medium flex items-center justify-center gap-1.5"
      >
        <span>⚙️</span>
        <span>Панель</span>
      </button>
    </div>
  );
}
