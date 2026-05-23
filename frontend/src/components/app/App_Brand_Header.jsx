export function App_Brand_Header() {
  return (
    <div className="hidden lg:block fixed top-2 left-2 sm:top-3 sm:left-3 z-[1200]">
      <div className="w-[300px] rounded-2xl border border-blue-400/40 bg-blue-950/30 px-3 py-2 text-sm text-blue-100 shadow-lg shadow-blue-900/20 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-blue-300/60 bg-white">
            <img src="/drone.svg" alt="Логотип сайта" className="h-6 w-6" />
          </div>
          <div className="min-w-0 leading-tight"><p className="truncate"><strong className="text-lg">Drones Control Center</strong></p></div>
        </div>
      </div>
    </div>
  );
}
