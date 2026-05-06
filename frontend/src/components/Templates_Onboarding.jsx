import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'vineyard_templates_onboarding_v1';

function readStorage() {
  if (typeof window === 'undefined') return { tourDone: false, hideFab: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tourDone: false, hideFab: false };
    const parsed = JSON.parse(raw);
    return { tourDone: Boolean(parsed?.tourDone), hideFab: Boolean(parsed?.hideFab) };
  } catch {
    return { tourDone: false, hideFab: false };
  }
}

function writeStorage(patch) {
  if (typeof window === 'undefined') return;
  const next = { ...readStorage(), ...(patch || {}) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function queryTarget(selector) {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`[data-onboarding="${selector}"]`);
}

function useTargetRect(targetAttr, stepIndex, tourOpen) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!tourOpen || !targetAttr) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = queryTarget(targetAttr);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const el = queryTarget(targetAttr);
    if (el) ro.observe(el);
    const id = window.setInterval(measure, 450);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      ro.disconnect();
      window.clearInterval(id);
    };
  }, [targetAttr, stepIndex, tourOpen]);
  return rect;
}

const STEPS = [
  {
    id: 'tpl-create',
    target: 'tpl-create',
    title: 'Шаг 1. Создать шаблон',
    text:
      'Нажмите «Создать шаблон». Откроется карта с режимом редактирования маршрута: кликайте по карте, чтобы добавить точки (нужно минимум 2).',
  },
  {
    id: 'tpl-start',
    target: 'tpl-start',
    title: 'Шаг 2. Начать работу',
    text:
      'Кнопка «Начать работу» открывает рабочую карту. Если у вас уже есть шаблоны — удобнее выбирать «Использовать» у нужного шаблона.',
  },
  {
    id: 'tpl-list',
    target: 'tpl-list',
    title: 'Шаг 3. Список шаблонов',
    text:
      'Здесь хранятся сохранённые маршруты. У каждого шаблона есть действия справа.',
  },
  {
    id: 'tpl-use',
    target: 'tpl-use',
    title: 'Шаг 4. Использовать шаблон',
    text:
      'Нажмите «Использовать»: откроется рабочая карта с превью маршрута. Далее выберите дрона — маршрут применится, и можно запускать миссию.',
  },
  {
    id: 'tpl-edit',
    target: 'tpl-edit',
    title: 'Шаг 5. Редактировать маршрут',
    text:
      'Откроет карту и позволит править точки маршрута. После правок сохраните шаблон.',
  },
  {
    id: 'tpl-delete',
    target: 'tpl-delete',
    title: 'Шаг 6. Удалить',
    text:
      'Удаление может быть каскадным, если выбрать «маршрут и зону». Всегда внимательно читайте предупреждение.',
  },
];

export function TemplatesOnboarding({ enabled, onTourOpenChange, onStepChange }) {
  const [storage, setStorage] = useState(() => readStorage());
  const [introOpen, setIntroOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    setStorage(readStorage());
  }, [enabled]);

  const step = STEPS[stepIndex] ?? STEPS[0];
  const rect = useTargetRect(step?.target, stepIndex, tourOpen);

  useEffect(() => {
    if (typeof onTourOpenChange === 'function') {
      onTourOpenChange(Boolean(tourOpen));
    }
  }, [tourOpen, onTourOpenChange]);

  useEffect(() => {
    if (!tourOpen) return;
    if (typeof onStepChange === 'function') {
      onStepChange(step?.id ?? null, stepIndex);
    }
  }, [tourOpen, step?.id, stepIndex, onStepChange]);

  const persist = useCallback((patch) => {
    writeStorage(patch);
    setStorage(readStorage());
  }, []);

  const closeTour = useCallback(() => {
    setTourOpen(false);
    setStepIndex(0);
    persist({ tourDone: true });
  }, [persist]);

  const startTour = useCallback(() => {
    setIntroOpen(false);
    setStepIndex(0);
    setTourOpen(true);
  }, []);

  const nextStep = useCallback(() => {
    if (stepIndex >= STEPS.length - 1) {
      closeTour();
      return;
    }
    setStepIndex((i) => i + 1);
  }, [stepIndex, closeTour]);

  const prevStep = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    if (!tourOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeTour();
      if (e.key === 'ArrowRight') nextStep();
      if (e.key === 'ArrowLeft') prevStep();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [tourOpen, closeTour, nextStep, prevStep]);

  const showFab = enabled && !storage.hideFab && !introOpen && !tourOpen;

  const introModal =
    introOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[2400] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" aria-hidden />
            <div className="relative w-full max-w-md rounded-2xl border border-amber-500/40 bg-gray-900/95 p-4 text-white shadow-2xl">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-300/90">Подсказка</p>
                  <h2 className="mt-1 text-lg font-bold text-white">Показать тур по шаблонам?</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIntroOpen(false)}
                  className="rounded-lg px-2 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-white min-h-[40px] min-w-[40px]"
                  aria-label="Закрыть"
                  title="Закрыть"
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-gray-200">
                Тур подсветит кнопки и покажет, в каком порядке: создавать, редактировать и использовать шаблоны.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    persist({ hideFab: true });
                    setIntroOpen(false);
                  }}
                  className="rounded-lg border border-gray-600 px-3 py-2.5 min-h-[44px] text-sm text-gray-200 hover:bg-gray-800"
                >
                  Не показывать
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIntroOpen(false)}
                    className="rounded-lg bg-gray-700 px-4 py-2.5 min-h-[44px] text-sm text-white hover:bg-gray-600"
                  >
                    Закрыть
                  </button>
                  <button
                    type="button"
                    onClick={startTour}
                    className="rounded-lg bg-amber-500 px-4 py-2.5 min-h-[44px] text-sm font-semibold text-gray-900 hover:bg-amber-400"
                  >
                    Начать
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const overlay = useMemo(() => {
    if (!tourOpen || typeof document === 'undefined') return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const hasTarget = rect && rect.width > 0 && rect.height > 0;
    const cx = hasTarget ? rect.left + rect.width / 2 : vw / 2;
    const cy = hasTarget ? rect.top + rect.height / 2 : vh * 0.35;

    const cardW = Math.min(vw * 0.92, 420);
    const cardH = 260; // оценка высоты карточки для избежания перекрытий
    const gap = 28;
    const pad = 12;

    // Базовое положение (как было).
    let left = Math.max(12, Math.min(cx - cardW / 2, vw - cardW - 12));
    let top =
      cy > vh * 0.55 ? Math.max(12, cy - 240) : Math.min(vh - 160, cy + (hasTarget ? rect.height / 2 : 0) + 18);

    // Если карточка перекрывает цель — уезжаем в сторону / вверх-вниз.
    if (hasTarget) {
      const targetBox = {
        left: Math.max(0, rect.left - pad),
        top: Math.max(0, rect.top - pad),
        right: rect.left + rect.width + pad,
        bottom: rect.top + rect.height + pad,
      };
      const cardBox = { left, top, right: left + cardW, bottom: top + cardH };
      const intersects = !(
        cardBox.right < targetBox.left ||
        cardBox.left > targetBox.right ||
        cardBox.bottom < targetBox.top ||
        cardBox.top > targetBox.bottom
      );
      if (intersects) {
        // Пытаемся справа от цели
        const rightLeft = targetBox.right + gap;
        const leftLeft = targetBox.left - gap - cardW;
        const preferRight = rightLeft + cardW <= vw - 12;
        if (preferRight) {
          left = Math.min(vw - cardW - 12, Math.max(12, rightLeft));
          top = Math.max(12, Math.min(targetBox.top, vh - cardH - 12));
        } else if (leftLeft >= 12) {
          left = Math.max(12, leftLeft);
          top = Math.max(12, Math.min(targetBox.top, vh - cardH - 12));
        } else {
          // иначе уводим вверх или вниз
          const belowTop = targetBox.bottom + gap;
          const aboveTop = targetBox.top - gap - cardH;
          if (belowTop + cardH <= vh - 12) {
            top = belowTop;
          } else if (aboveTop >= 12) {
            top = aboveTop;
          }
          left = Math.max(12, Math.min(cx - cardW / 2, vw - cardW - 12));
        }
      }
    }

    const pointer = hasTarget ? (
      <div
        className="pointer-events-none fixed z-[2001] text-amber-400 drop-shadow-lg"
        style={{
          left: cx - 18,
          top: Math.max(8, rect.top - 32),
          fontSize: 36,
          lineHeight: 1,
        }}
        aria-hidden="true"
      >
        ▼
      </div>
    ) : null;

    const cutout = hasTarget ? (
      <div
        className="pointer-events-none fixed z-[2000] rounded-xl ring-4 ring-amber-400 ring-offset-2 ring-offset-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-all duration-200"
        style={{
          top: Math.max(0, rect.top - 6),
          left: Math.max(0, rect.left - 6),
          width: rect.width + 12,
          height: rect.height + 12,
        }}
      />
    ) : null;

    const card = (
      <div
        className="fixed z-[2002] w-[min(92vw,420px)] rounded-2xl border border-amber-500/50 bg-gray-900/98 p-4 text-white shadow-2xl backdrop-blur-md"
        style={{ left, top }}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300/90">
            Шаг {stepIndex + 1} из {STEPS.length}
          </p>
          <button
            type="button"
            onClick={closeTour}
            className="rounded-lg px-2 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-white min-h-[40px] min-w-[40px]"
            title="Закрыть (Esc)"
          >
            ✕
          </button>
        </div>
        <h2 className="mt-1 text-lg font-bold text-white">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-200">{step.text}</p>
        {!hasTarget && (
          <p className="mt-2 text-xs text-amber-200">
            Элемент сейчас не виден на экране — прокрутите или измените окно, затем нажмите «Далее».
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-gray-700/80 pt-3">
          <button
            type="button"
            onClick={prevStep}
            disabled={stepIndex === 0}
            className="rounded-lg border border-gray-600 px-3 py-2.5 min-h-[44px] text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-40"
          >
            Назад
          </button>
          <button
            type="button"
            onClick={nextStep}
            className="rounded-lg bg-amber-500 px-3 py-2.5 min-h-[44px] text-sm font-semibold text-gray-950 hover:bg-amber-400"
          >
            Далее →
          </button>
        </div>
      </div>
    );

    return (
      <div className="fixed inset-0 z-[1999]">
        <div className="absolute inset-0 bg-black/70" onMouseDown={closeTour} />
        {cutout}
        {pointer}
        {card}
      </div>
    );
  }, [tourOpen, rect, stepIndex, step, closeTour, nextStep, prevStep]);

  const fab = showFab ? (
    <button
      type="button"
      className="absolute bottom-[5.5rem] left-4 z-[1400] flex h-14 w-14 items-center justify-center rounded-full border-2 border-amber-400 bg-amber-500 text-2xl font-black text-gray-900 shadow-lg shadow-amber-900/40 animate-pulse hover:animate-none hover:bg-amber-400 lg:bottom-8"
      style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      title="Подсказка по шаблонам"
      aria-label="Открыть подсказку по шаблонам"
      onClick={() => setIntroOpen(true)}
    >
      !
    </button>
  ) : null;

  if (typeof document === 'undefined') return null;
  return (
    <>
      {fab}
      {introModal}
      {overlay ? createPortal(overlay, document.body) : null}
    </>
  );
}

