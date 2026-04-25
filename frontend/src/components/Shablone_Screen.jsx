import { useState } from 'react';

/**
 * Shablone Screen — управление шаблонами маршрутов патрулирования.
 * Шаблон = заранее построенный маршрут (название + точки на карте).
 * @param {{
 *   onStart: (templateId?: string) => void;
 *   templates: { id: string; name: string; path: [number, number][]; zoneId?: number | null }[];
 *   onStartCreateTemplate: () => void;
 *   onEditTemplateRoute: (id: string) => void;
 *   onDeleteTemplate: (id: string, mode: 'route_only' | 'route_and_zone') => void;
 *   templateCascadeCountById?: Record<string, number>;
 *   templateCascadeMetaById?: Record<string, { zoneName?: string; relatedTemplateNames?: string[] }>;
 * }} props
 */
export function ShabloneScreen({
  onStart,
  templates,
  onStartCreateTemplate,
  onEditTemplateRoute,
  onDeleteTemplate,
  templateCascadeCountById = {},
  templateCascadeMetaById = {}
}) {
  const [deleteDialog, setDeleteDialog] = useState(null);

  const handleDelete = (id, mode) => {
    onDeleteTemplate(id, mode);
    setDeleteDialog(null);
  };
  const templateForDelete = deleteDialog?.id
    ? templates.find((x) => x.id === deleteDialog.id) ?? null
    : null;
  const cascadeCount =
    templateForDelete != null
      ? Number(templateCascadeCountById?.[templateForDelete.id] || 0)
      : 0;
  const cascadeMeta =
    templateForDelete != null
      ? templateCascadeMetaById?.[templateForDelete.id] ?? null
      : null;
  const relatedNames = Array.isArray(cascadeMeta?.relatedTemplateNames)
    ? cascadeMeta.relatedTemplateNames
    : [];

  return (
    <div className="w-full max-w-6xl mx-auto">
      <div className="w-full max-w-2xl mx-auto bg-gray-800/85 border border-gray-700/70 rounded-2xl shadow-2xl backdrop-blur-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-700/80 bg-gradient-to-r from-gray-800 to-gray-900">
          <h2 className="text-2xl font-bold text-white">Шаблоны маршрутов патрулирования</h2>
          <p className="text-gray-400 text-sm mt-1">
            Создайте маршрут по карте, сохраните его как шаблон и используйте для дронов.
          </p>
        </div>
        <div className="px-6 py-4 flex flex-wrap gap-3 justify-between items-center bg-gray-800/70">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onStartCreateTemplate}
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-lg font-medium transition-all shadow-sm ring-1 ring-blue-400/40"
            >
              + Создать шаблон
            </button>
            <button
              type="button"
              onClick={() => onStart()}
              className="group relative overflow-hidden px-4 py-2 bg-gradient-to-r from-gray-700 to-gray-800 text-white rounded-lg font-medium transition-all duration-300 ease-out border border-gray-600/80 shadow-sm ring-1 ring-gray-500/30 hover:ring-green-400/40 hover:shadow-md"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-green-600 to-emerald-600 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100"
              />
              <span className="relative z-10">Начать работу</span>
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          <h3 className="text-lg font-semibold text-white mb-3">Сохранённые шаблоны ({templates.length})</h3>
          {templates.length === 0 ? (
            <p className="text-gray-500 py-6 text-center">
              Нет шаблонов. Нажмите «Создать шаблон», чтобы нарисовать маршрут на карте и сохранить его.
            </p>
          ) : (
            <ul className="space-y-2">
              {templates.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 px-4 bg-gray-700/40 rounded-lg border border-gray-600/80 hover:border-blue-500/50 hover:bg-gray-700/70 transition-all"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-white truncate">{t.name}</p>
                    <p className="text-sm text-gray-400">
                      {(t.path && t.path.length) || 0} точек маршрута
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => onEditTemplateRoute(t.id)}
                      className="h-8 px-2 sm:px-3 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap"
                      title="Редактировать маршрут на карте"
                    >
                      Редактировать маршрут
                    </button>
                    <button
                      type="button"
                      onClick={() => onStart(t.id)}
                      className="h-8 px-2 sm:px-3 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap"
                      title="Начать работу и применить шаблон к дрону"
                    >
                      Использовать
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteDialog({ id: t.id, mode: null })}
                      className="h-8 px-2 sm:px-3 bg-red-900/70 hover:bg-red-800 text-red-200 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap"
                      title="Удалить"
                    >
                      Удалить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {deleteDialog && templateForDelete && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-600 bg-gray-900 text-white shadow-2xl p-4">
            <h4 className="text-lg font-semibold mb-2">Удаление шаблона</h4>
            <p className="text-sm text-gray-300 mb-3">
              Выберите вариант удаления для шаблона <span className="text-white font-medium">«{templateForDelete.name || 'Без названия'}»</span>.
            </p>

            {deleteDialog.mode == null ? (
              <div className="space-y-2">
                {cascadeCount > 0 && (
                  <div className="rounded-lg border border-amber-500/60 bg-amber-900/35 px-3 py-2 text-xs text-amber-100">
                    Внимание: этот шаблон связан с зоной <strong>«{cascadeMeta?.zoneName || 'не определена'}»</strong>,
                    где есть ещё <strong>{cascadeCount}</strong> маршрут(а/ов). При удалении они также будут удалены.
                    {relatedNames.length > 0 && (
                      <span className="block mt-1">
                        Маршруты: <strong>{relatedNames.join(', ')}</strong>.
                      </span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setDeleteDialog({ id: templateForDelete.id, mode: 'route_only' })}
                  className="w-full h-10 px-3 bg-red-700 hover:bg-red-800 rounded-lg text-sm font-medium"
                >
                  Удалить только маршрут
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteDialog({ id: templateForDelete.id, mode: 'route_and_zone' })}
                  disabled={templateForDelete?.zoneId == null}
                  className="w-full h-10 px-3 bg-rose-900 hover:bg-rose-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium"
                  title={
                    templateForDelete?.zoneId == null
                      ? 'У шаблона нет привязанной зоны'
                      : 'Удалить шаблон и связанную зону'
                  }
                >
                  Удалить маршрут и зону
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteDialog(null)}
                  className="w-full h-10 px-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium"
                >
                  Отмена
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-300">
                  Подтвердите действие:
                  <span className="text-white font-medium">
                    {' '}
                    {deleteDialog.mode === 'route_only' ? 'только маршрут' : 'маршрут и зона'}.
                  </span>
                </p>
                {cascadeCount > 0 && (
                  <div className="rounded-lg border border-red-500/60 bg-red-900/25 px-3 py-2 text-xs text-red-100">
                    Будут удалены дополнительно: <strong>{cascadeCount}</strong> маршрут(а/ов) из зоны{' '}
                    <strong>«{cascadeMeta?.zoneName || 'не определена'}»</strong>.
                    {relatedNames.length > 0 && (
                      <span className="block mt-1">
                        Список: <strong>{relatedNames.join(', ')}</strong>.
                      </span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(templateForDelete.id, deleteDialog.mode)}
                  className="w-full h-10 px-3 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-medium"
                >
                  Подтвердить удаление
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteDialog({ id: templateForDelete.id, mode: null })}
                  className="w-full h-10 px-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium"
                >
                  Назад
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
