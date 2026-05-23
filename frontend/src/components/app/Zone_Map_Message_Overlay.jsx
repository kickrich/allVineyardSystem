export function Zone_Map_Message_Overlay({ message, isError, visible, onDismiss }) {
  return (
    <div className="pointer-events-none absolute top-2 left-1/2 z-[220] w-[min(92vw,560px)] -translate-x-1/2 px-2">
      <div className={`pointer-events-auto rounded-xl border px-3 py-2 text-sm shadow-xl backdrop-blur-sm transition-all duration-250 ease-out ${isError ? 'border-red-500/70 bg-red-950/85 text-red-100' : 'border-emerald-500/70 bg-emerald-950/85 text-emerald-100'} ${visible ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'}`}>
        <div className="flex items-start justify-between gap-2">
          <span>{message}</span>
          <button type="button" className="rounded px-2 py-0.5 text-xs hover:bg-black/20" onClick={onDismiss} aria-label="Скрыть сообщение">✕</button>
        </div>
      </div>
    </div>
  );
}
