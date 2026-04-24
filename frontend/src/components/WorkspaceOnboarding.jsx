import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { readWorkspaceOnboarding, writeWorkspaceOnboarding } from '../constants/onboarding';

const STEPS = [
  {
    id: 'zone-draw',
    target: 'zone-draw',
    title: 'Шаг 1. Зона работы',
    text:
      'Нажмите кнопку с прямоугольником справа на карте. Затем зажмите мышь на карте и отпустите, чтобы нарисовать зону. Сохраните её. При необходимости зоны можно загрузить из KML в панели (меню зон на карте — следующий шаг).',
  },
  {
    id: 'zone-menu',
    target: 'zone-map-menu',
    title: 'Шаг 2. Активная зона',
    text:
      'Откройте меню «гамбургер» в левом верхнем углу карты и выберите нужную зону — она станет активной. Маршрут можно строить только внутри контура активной зоны.',
  },
  {
    id: 'place-drone',
    target: 'place-drone',
    title: 'Шаг 3. Дрон на карте',
    text:
      'В стоянке слева (на телефоне — кнопка «Стоянка» внизу) нажмите «Разместить» у дрона, затем кликните по карте внутри зоны, чтобы поставить маркер.',
  },
  {
    id: 'route-build',
    target: 'route-build',
    title: 'Шаг 4. Маршрут',
    text:
      'Откройте правую панель («Панель» на телефоне), выберите дрон в списке и нажмите «Построить маршрут». Кликами по карте внутри зоны добавляйте точки; затем «Закончить маршрут».',
  },
];

function queryTarget(selector) {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`[data-onboarding="${selector}"]`);
}

function useTargetRect(targetAttr, stepIndex, tourOpen, resizeNonce) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    if (!tourOpen || targetAttr == null) {
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
    const id = window.setInterval(measure, 400);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      ro.disconnect();
      window.clearInterval(id);
    };
  }, [targetAttr, stepIndex, tourOpen, resizeNonce]);
  return rect;
}

/**
 * Подсказка для новых пользователей: мигающий «!», модалка с порядком работ, пошаговый тур со стрелкой к элементам.
 */
export function WorkspaceOnboarding({ enabled, onBeforeStep }) {
  const [storage, setStorage] = useState(() => readWorkspaceOnboarding());
  const [introOpen, setIntroOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [resizeNonce, setResizeNonce] = useState(0);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    setStorage(readWorkspaceOnboarding());
  }, [enabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const fn = () => setNarrow(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  useEffect(() => {
    const onResize = () => setResizeNonce((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const showFab = enabled && !storage.hideFab && !introOpen && !tourOpen;

  const step = STEPS[stepIndex] ?? STEPS[0];
  const rect = useTargetRect(step?.target, stepIndex, tourOpen, resizeNonce);

  const persist = useCallback((patch) => {
    writeWorkspaceOnboarding(patch);
    setStorage(readWorkspaceOnboarding());
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
    onBeforeStep?.(STEPS[0].id, 0);
  }, [onBeforeStep]);

  useEffect(() => {
    if (!tourOpen) return;
    onBeforeStep?.(step.id, stepIndex);
  }, [tourOpen, step.id, stepIndex, onBeforeStep]);

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

  const skipMissingAndNext = useCallback(() => {
    if (stepIndex >= STEPS.length - 1) {
      closeTour();
      return;
    }
    setStepIndex((i) => i + 1);
  }, [stepIndex, closeTour]);

  const overlay = useMemo(() => {
    if (!tourOpen || typeof document === 'undefined') return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardMax = 'min(92vw, 420px)';
    const hasTarget = rect && rect.width > 0 && rect.height > 0;
    const cx = hasTarget ? rect.left + rect.width / 2 : vw / 2;
    const cy = hasTarget ? rect.top + rect.height / 2 : vh * 0.35;
    const tipLeft = Math.min(Math.max(16, cx - 160), vw - 320 - 16);
    const halfH = hasTarget ? rect.height / 2 : 0;
    const tipTop =
      cy > vh * 0.55 ? Math.max(80, cy - 220) : Math.min(vh - 200, cy + halfH + 24);
    const targetMissing = !queryTarget(step.target);

    return createPortal(
      <div className="fixed inset-0 z-[1500] pointer-events-none" aria-hidden={false}>
        <div className="absolute inset-0 bg-black/45 pointer-events-none" aria-hidden />
        {hasTarget && (
          <>
            <div
              className="absolute rounded-xl ring-4 ring-amber-400 ring-offset-2 ring-offset-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] pointer-events-none transition-all duration-200"
              style={{
                top: rect.top - 6,
                left: rect.left - 6,
                width: rect.width + 12,
                height: rect.height + 12,
              }}
            />
            <div
              className="absolute pointer-events-none text-amber-400 drop-shadow-lg"
              style={{
                left: cx - 18,
                top: Math.max(8, rect.top - 32),
                fontSize: 36,
                lineHeight: 1,
              }}
            >
              ▼
            </div>
          </>
        )}
        <div
          className="absolute z-[1510] flex flex-col gap-3 rounded-2xl border border-amber-500/50 bg-gray-900/95 p-4 text-white shadow-2xl backdrop-blur-md pointer-events-auto"
          style={{ left: tipLeft, top: tipTop, width: cardMax, maxWidth: 420 }}
          role="dialog"
          aria-labelledby="onboarding-step-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300/90">
              Шаг {stepIndex + 1} из {STEPS.length}
            </p>
            <button
              type="button"
              onClick={closeTour}
              className="rounded-lg px-2 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-white"
            >
              ✕
            </button>
          </div>
          <h2 id="onboarding-step-title" className="text-lg font-bold text-white">
            {step.title}
          </h2>
          <p className="text-sm leading-relaxed text-gray-200">{step.text}</p>
          {narrow && (step.id === 'place-drone' || step.id === 'route-build') && (
            <p className="text-xs text-amber-200/90">
              На узком экране панели открываются кнопками внизу: «Стоянка» и «Панель».
            </p>
          )}
          {!hasTarget && (
            <p className="text-xs text-amber-200">
              Элемент пока не на экране (например, меню зон появится после появления зон). Нажмите «Пропустить шаг».
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={prevStep}
              disabled={stepIndex === 0}
              className="rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-40"
            >
              Назад
            </button>
            <div className="flex gap-2">
              {targetMissing && (
                <button
                  type="button"
                  onClick={skipMissingAndNext}
                  className="rounded-lg border border-amber-600/60 px-3 py-2 text-sm text-amber-100 hover:bg-amber-900/40"
                >
                  Пропустить шаг
                </button>
              )}
              <button
                type="button"
                onClick={nextStep}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-amber-400"
              >
                {stepIndex >= STEPS.length - 1 ? 'Готово' : 'Далее'}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }, [tourOpen, rect, step, stepIndex, narrow, closeTour, nextStep, prevStep, skipMissingAndNext]);

  const introModal =
    introOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4 bg-black/60" role="dialog">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-600 bg-gray-900 p-6 text-white shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-2">Как начать работу</h2>
              <ol className="list-decimal space-y-3 pl-5 text-sm text-gray-200 leading-relaxed">
                <li>
                  <strong className="text-white">Зона.</strong> Создайте или выберите зону с контуром на карте (кнопка
                  прямоугольника или меню зон слева сверху на карте).
                </li>
                <li>
                  <strong className="text-white">Дрон.</strong> Из стоянки разместите дрон на карте внутри зоны.
                </li>
                <li>
                  <strong className="text-white">Маршрут.</strong> В правой панели включите «Построить маршрут» и
                  кликайте по карте внутри зоны. Затем запускайте миссию по подсказкам в панели.
                </li>
              </ol>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setIntroOpen(false);
                    persist({ hideFab: true });
                  }}
                  className="rounded-lg border border-gray-500 px-4 py-2.5 text-sm text-gray-200 hover:bg-gray-800"
                >
                  Понятно, скрыть подсказку
                </button>
                <button
                  type="button"
                  onClick={startTour}
                  className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-gray-900 hover:bg-amber-400"
                >
                  Пошаговый тур 
                </button>
                <button
                  type="button"
                  onClick={() => setIntroOpen(false)}
                  className="rounded-lg bg-gray-700 px-4 py-2.5 text-sm text-white hover:bg-gray-600"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {showFab && (
        <button
          type="button"
          className="fixed bottom-[5.5rem] left-4 z-[1400] flex h-14 w-14 items-center justify-center rounded-full border-2 border-amber-400 bg-amber-500 text-2xl font-black text-gray-900 shadow-lg shadow-amber-900/40 animate-pulse hover:animate-none hover:bg-amber-400 lg:bottom-8"
          style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
          title="Подсказка для новых пользователей"
          aria-label="Открыть подсказку"
          onClick={() => setIntroOpen(true)}
        >
          !
        </button>
      )}
      {introModal}
      {overlay}
    </>
  );
}
