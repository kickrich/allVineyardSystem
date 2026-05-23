export function Zone_Rect_Draw_Panel({
  drawRectZoneMode,
  draftRectBoundary,
  newRectZoneName,
  onZoneNameChange,
  draftRectZoneColor,
  onColorChange,
  onSave,
  onCancel,
  saveDisabled,
  cancelDisabled,
  editingZoneId,
  showDeleteZone = false,
  onDeleteZone,
  deleteDisabled,
  deleteTitle,
  templateUsageCount = 0,
}) {
  if (!drawRectZoneMode && !draftRectBoundary) return null;

  const deleteBlocked = templateUsageCount > 0;

  return (
    <div className="absolute top-2 left-2 z-[130] w-[min(82vw,340px)] rounded-xl border border-amber-600/40 bg-gray-900/80 p-2 backdrop-blur-sm">
      {drawRectZoneMode && !draftRectBoundary && (
        <p className="text-xs text-amber-200">
          Зажмите кнопку мыши на карте, потяните и отпустите, чтобы нарисовать прямоугольник.
        </p>
      )}
      {draftRectBoundary && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 items-stretch">
            <input
              type="text"
              value={newRectZoneName}
              onChange={(e) => onZoneNameChange(e.target.value)}
              placeholder="Имя зоны"
              className="px-3 py-2 bg-gray-800 border border-amber-700/60 rounded-lg text-white text-sm min-h-[42px] w-full"
            />
            <label className="relative w-full px-3 py-2 min-h-[42px] bg-gray-800 border border-gray-500/70 rounded-lg text-white text-sm flex items-center justify-end">
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center whitespace-nowrap">
                Цвет зоны
              </span>
              <input
                type="color"
                value={draftRectZoneColor}
                onChange={onColorChange}
                className="h-7 w-10 p-0 border-0 rounded cursor-pointer bg-transparent"
                title="Выбрать цвет зоны"
              />
            </label>
            <button
              type="button"
              onClick={onSave}
              disabled={saveDisabled}
              className="w-full px-3 py-2 min-h-[42px] bg-transparent border border-gray-500/70 text-gray-100 hover:bg-emerald-700/80 hover:text-white disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              {editingZoneId != null ? 'Сохранить изменения' : 'Сохранить зону'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelDisabled}
              className="w-full px-3 py-2 min-h-[42px] bg-transparent border border-gray-500/70 text-gray-200 hover:bg-black/80 hover:text-white disabled:opacity-50 rounded-lg text-sm transition-colors"
            >
              Отмена редактирования
            </button>
            {showDeleteZone && editingZoneId != null && (
              <button
                type="button"
                onClick={onDeleteZone}
                disabled={deleteDisabled}
                title={deleteTitle ?? (deleteBlocked ? 'Зона используется в шаблонах' : 'Удалить активную зону')}
                className="w-full px-3 py-2 min-h-[42px] bg-transparent border border-gray-500/70 text-gray-100 hover:bg-red-900/80 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
              >
                {deleteBlocked ? 'Зона в шаблонах' : 'Удалить зону'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
