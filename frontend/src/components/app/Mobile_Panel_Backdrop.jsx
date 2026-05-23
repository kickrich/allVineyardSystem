export function Mobile_Panel_Backdrop({ open, onClose }) {
  if (!open) return null;
  return (
    <button type="button" aria-label="Закрыть" className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
  );
}
