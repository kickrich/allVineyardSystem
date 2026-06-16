export function Ai_Cloud_Notice({ notice, visible, exiting, onDismiss, onOpenPanel }) {
  return (
    <div className={`fixed top-20 right-2 sm:top-24 sm:right-3 z-[1200] w-[min(92vw,360px)] transition-all duration-300 ease-in-out ${visible ? 'translate-y-0 opacity-100' : `${exiting ? '-translate-y-3' : 'translate-y-3'} opacity-0`}`}>
      <div className="rounded-2xl border border-sky-300/50 bg-sky-950/70 px-4 py-3 shadow-xl backdrop-blur-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-sky-200/90">Облако AI</p>
            <p className="mt-0.5 text-sm text-sky-50">Результат для миссии <strong>#{notice.missionId}</strong> готов</p>
            <p className="mt-1 text-xs text-sky-100/90">Кустов: {notice.bushesCount}, пропусков: {notice.gapsCount}{notice.droneName ? `, дрон: ${notice.droneName}` : ''}</p>
          </div>
          <button type="button" onClick={onDismiss} className="rounded-lg border border-sky-300/40 px-2 py-1 text-xs text-sky-100 hover:bg-sky-900/70">✕</button>
        </div>
        <button type="button" onClick={onOpenPanel} className="mt-3 inline-flex items-center justify-center rounded-xl bg-sky-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500">Перейти в панель кустов</button>
      </div>
    </div>
  );
}
