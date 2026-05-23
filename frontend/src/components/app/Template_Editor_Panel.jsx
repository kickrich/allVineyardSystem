export function Template_Editor_Panel({
  templateEditMode,
  templateDraftPath,
  templateDraftName,
  onTemplateNameChange,
  drawRectZoneMode,
  onToggleDrawRectZone,
  onUndoPoint,
  onSave,
  onCancel,
}) {
  return (
    <div className="pointer-events-none absolute bottom-4 left-0 right-4 z-[100] flex flex-col items-start gap-2">
      <div className="pointer-events-auto w-full max-w-md bg-gray-800/95 border border-gray-600 rounded-xl p-4 shadow-xl">
        <h3 className="font-semibold text-white mb-2">
          {templateEditMode === 'create' ? 'Создание шаблона маршрута' : 'Редактирование маршрута'}
        </h3>
        <p className="text-gray-400 text-sm mb-3">
          Кликайте по карте, чтобы добавить точки маршрута патрулирования.
        </p>
        <p className="text-gray-400 text-xs mb-3">
          Режим как в рабочей зоне: можно тянуть узлы и сегменты, маршрут строится внутри активной зоны.
        </p>
        <p className="text-white/80 text-sm mb-3">
          Точек: <strong>{templateDraftPath.length}</strong>
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={onUndoPoint}
            disabled={!templateDraftPath.length}
            className="px-3 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium"
          >
            Отменить последнюю
          </button>
          <button
            type="button"
            onClick={onToggleDrawRectZone}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              drawRectZoneMode
                ? 'bg-amber-900 hover:bg-amber-800 text-amber-100 border border-amber-500/70'
                : 'bg-amber-700 hover:bg-amber-600 text-white border border-amber-500/60'
            }`}
            title={drawRectZoneMode ? 'Отменить создание зоны' : 'Создать зону'}
          >
            {drawRectZoneMode ? 'Отменить создание зоны' : 'Создать зону'}
          </button>
        </div>
        <div className="mb-3">
          <label className="block text-sm text-gray-400 mb-1">Название шаблона</label>
          <input
            type="text"
            value={templateDraftName}
            onChange={(e) => onTemplateNameChange(e.target.value)}
            placeholder="Например: Облёт периметра"
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-green-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={templateDraftPath.length < 2}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium"
          >
            Сохранить шаблон
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
