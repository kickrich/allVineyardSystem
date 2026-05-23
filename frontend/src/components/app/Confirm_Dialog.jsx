export function Confirm_Dialog({ confirmUi, onResolve }) {
  if (!confirmUi) return null;
  return (
    <div
      className="fixed inset-0 z-[1400] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={confirmUi.title}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onResolve(false); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md rounded-2xl border border-gray-600 bg-gray-950/95 p-4 text-white shadow-2xl">
        <h3 className="text-lg font-semibold">{confirmUi.title}</h3>
        <p className="mt-2 whitespace-pre-line text-sm text-gray-300">{confirmUi.message}</p>
        {confirmUi.warning && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-950/25 px-3 py-2 text-xs text-red-100">{confirmUi.warning}</div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={() => onResolve(false)} className="h-10 rounded-lg bg-gray-800 px-4 text-sm font-medium text-gray-100 hover:bg-gray-700">{confirmUi.cancelText}</button>
          <button type="button" onClick={() => onResolve(true)} className={`h-10 rounded-lg px-4 text-sm font-semibold ${confirmUi.tone === 'danger' ? 'bg-red-700 text-red-50 hover:bg-red-600' : 'bg-emerald-700 text-emerald-50 hover:bg-emerald-600'}`}>{confirmUi.confirmText}</button>
        </div>
      </div>
    </div>
  );
}
