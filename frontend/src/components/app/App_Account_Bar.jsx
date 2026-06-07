export function App_Account_Bar({ authUserLabel, onLogout }) {
  return (
    <div className="fixed top-2 right-2 sm:top-3 sm:right-3 z-[1200]">
      <div className="w-[300px] rounded-2xl border border-[rgba(0,188,125,0.4)] bg-emerald-900/30 px-3 py-2 text-sm text-emerald-100 shadow-lg shadow-emerald-900/20 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-emerald-400/60 bg-emerald-950/70 text-2xl leading-none">👤</div>
            <div className="min-w-0 leading-tight">
              <p className="text-[11px] uppercase tracking-wide text-emerald-300/90">Статус аккаунта</p>
              <p className="truncate">Вы вошли: <strong>{authUserLabel}</strong></p>
            </div>
          </div>
          <button type="button" onClick={onLogout} className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/60 bg-red-900/30 px-3 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-800/50 hover:text-white">
            <span className="text-base leading-none">↩</span><span>Выход</span>
          </button>
        </div>
      </div>
    </div>
  );
}
