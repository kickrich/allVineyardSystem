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
      'Меню зон — кнопка с тремя полосками в левом верхнем углу карты. Пока сохранённых зон нет, она видна только во время пошагового тура и подсвечена янтарным кольцом; откройте меню — внутри краткая подсказка. На шаге 2 тура сосредоточьтесь на выборе зоны здесь. Когда зоны появятся, выберите нужную — она станет активной. Маршрут можно строить только внутри контура активной зоны.',
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
      'Пока идёт тур, справа показан пример панели «как после размещения дрона». Выберите реальный дрон в списке (когда появится на карте), нажмите «Построить маршрут», кликами внутри зоны добавьте точки, затем «Закончить маршрут».',
  },
  {
    id: 'mission-first-waypoint',
    target: 'mission-first-waypoint',
    title: 'Шаг 5. Старт миссии и первая точка',
    text:
      'Блок «Управление полётом» и кнопка «Начать миссию» появляются, когда в маршруте не меньше двух точек. Старт миссии разрешён только если маркер дрона совпадает с первой точкой маршрута (в приложении — примерно в радиусе 10 м): полёт по плану всегда начинается с этой точки. Переместите дрон кнопкой «К первой точке миссии, что бы иметь возможность запустить миссию.',
  },
  {
    id: 'route-shift-segments',
    target: 'route-shift-segments',
    title: 'Шаг 6. Смещения между рядами',
    text:
      'Карта приблизится к примеру: внутри полупрозрачного контура зоны (как у вашей будущей зоны) — три отрезка оранжевой пунктирной линией, средний подсвечен фиолетовым: это «смещение» между рядами. Так в будущем нейросеть сможет резать видео: примерно один ряд — один файл. Если у вас уже есть сохранённая зона на карте, показывается только маршрут-пример поверх неё. Кнопка «Смещения» внизу справа открывает пояснение; свой маршрут вы потом построите в режиме «Построить маршрут» и отметите отрезки кликом по линии между точками.',
  },
];

function queryTarget(selector) {
  if (typeof document === 'undefined') return null;
  return document.querySelector(`[data-onboarding="${selector}"]`);
}

function useTargetRect(targetAttr, stepIndex, tourOpen, resizeNonce, layoutKey) {
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
  }, [targetAttr, stepIndex, tourOpen, resizeNonce, layoutKey]);
  return rect;
}

export function WorkspaceOnboarding({ enabled, onBeforeStep, onTourOpenChange, layoutKey = 0 }) {
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
  const rect = useTargetRect(step?.target, stepIndex, tourOpen, resizeNonce, layoutKey);

  useEffect(() => {
    onTourOpenChange?.(tourOpen);
  }, [tourOpen, onTourOpenChange]);

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
    const cardW = Math.min(vw * 0.92, 420);
    const tipLeft = Math.max(12, Math.min(cx - cardW / 2, vw - cardW - 12));
    const halfH = hasTarget ? rect.height / 2 : 0;
    const isRouteShiftOnboardingStep = step.id === 'route-shift-segments';
    let tipTop =
      cy > vh * 0.55 ? Math.max(72, cy - 240) : Math.min(vh - 120, cy + halfH + 16);
    const estCardPx = Math.min(400, vh * 0.52);
    const bottomGap = isRouteShiftOnboardingStep ? 40 : 12;
    tipTop = Math.max(12, Math.min(tipTop, vh - estCardPx - bottomGap));
    if (isRouteShiftOnboardingStep) {
      tipTop = Math.max(12, tipTop - 72);
    }
    const targetMissing = !queryTarget(step.target);
    const usePanelAdjacentCard =
      step.id === 'route-build' || step.id === 'mission-first-waypoint';

    const gap = 12;
    const minPanelCardW = 268;
    const maxPanelCardW = 404;
    const maxPanelCardH = Math.min(vh * 0.56, 460);
    let panelCardBox = null;
    let panelArrowLeft = null;
    if (usePanelAdjacentCard && hasTarget) {
      let w = Math.max(minPanelCardW, Math.min(maxPanelCardW, rect.left - gap * 2));
      let left = rect.left - gap - w;
      if (left < gap) {
        left = gap;
        w = Math.max(minPanelCardW, Math.min(maxPanelCardW, rect.left - gap - left));
      }
      let top = rect.top;
      top = Math.max(gap, Math.min(top, vh - maxPanelCardH - gap));
      panelCardBox = { left, top, width: w, maxHeight: maxPanelCardH };
      panelArrowLeft = left + w + 4;
    }

    const cardClass =
      'flex flex-col gap-3 rounded-2xl border border-amber-500/50 bg-gray-900/98 p-4 text-white shadow-2xl backdrop-blur-md pointer-events-auto touch-manipulation';

    const cardInner = (
      <>
        <div className="flex items-start justify-between gap-2 shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-300/90">
            Шаг {stepIndex + 1} из {STEPS.length}
          </p>
          <button
            type="button"
            onClick={closeTour}
            className="rounded-lg px-2 py-1 text-sm text-gray-400 hover:bg-gray-800 hover:text-white min-h-[40px] min-w-[40px]"
          >
            ✕
          </button>
        </div>
        <h2 id="onboarding-step-title" className="text-lg font-bold text-white shrink-0">
          {step.title}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-0.5">
          <p className="text-sm leading-relaxed text-gray-200">{step.text}</p>
          {narrow &&
            (step.id === 'place-drone' ||
              step.id === 'route-build' ||
              step.id === 'route-shift-segments' ||
              step.id === 'mission-first-waypoint') && (
              <p className="text-xs text-amber-200/90">
                На узком экране панель открывается кнопкой «Панель» внизу; во время тура она шире, чтобы были видны все
                кнопки. Стоянка — кнопка «Стоянка» (на шаге 3 откроется и стоянка).
              </p>
            )}
          {!hasTarget && (
            <p className="text-xs text-amber-200">
              Элемент пока не на экране (например, меню зон появится после появления зон). Нажмите «Пропустить шаг».
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 shrink-0 border-t border-gray-700/80 mt-1">
          <button
            type="button"
            onClick={prevStep}
            disabled={stepIndex === 0}
            className="rounded-lg border border-gray-600 px-3 py-2.5 min-h-[44px] text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-40"
          >
            Назад
          </button>
          <div className="flex gap-2">
            {targetMissing && (
              <button
                type="button"
                onClick={skipMissingAndNext}
                className="rounded-lg border border-amber-600/60 px-3 py-2.5 min-h-[44px] text-sm text-amber-100 hover:bg-amber-900/40"
              >
                Пропустить шаг
              </button>
            )}
            <button
              type="button"
              onClick={nextStep}
              className="rounded-lg bg-amber-500 px-4 py-2.5 min-h-[44px] text-sm font-semibold text-gray-900 hover:bg-amber-400"
            >
              {stepIndex >= STEPS.length - 1 ? 'Готово' : 'Далее'}
            </button>
          </div>
        </div>
      </>
    );

    return createPortal(
      <div className="fixed inset-0 z-[2400] flex flex-col pointer-events-auto" aria-hidden={false}>
        <div
          className={
            isRouteShiftOnboardingStep
              ? 'absolute inset-0 z-0 bg-transparent'
              : 'absolute inset-0 z-0 bg-black/45'
          }
          aria-hidden
        />
        {hasTarget && (
          <>
            <div
              className={
                isRouteShiftOnboardingStep
                  ? 'absolute z-[1] rounded-xl ring-4 ring-amber-400 ring-offset-2 ring-offset-gray-950/90 pointer-events-none transition-all duration-200'
                  : 'absolute z-[1] rounded-xl ring-4 ring-amber-400 ring-offset-2 ring-offset-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] pointer-events-none transition-all duration-200'
              }
              style={{
                top: rect.top - 6,
                left: rect.left - 6,
                width: rect.width + 12,
                height: rect.height + 12,
              }}
            />
            {!usePanelAdjacentCard && (
              <div
                className="absolute z-[1] pointer-events-none text-amber-400 drop-shadow-lg"
                style={{
                  left: cx - 18,
                  top: Math.max(8, rect.top - 32),
                  fontSize: 36,
                  lineHeight: 1,
                }}
              >
                ▼
              </div>
            )}
          </>
        )}
        {usePanelAdjacentCard && panelCardBox ? (
          <>
            <div
              className="pointer-events-none absolute z-[2]"
              style={{
                left: panelCardBox.left,
                top: panelCardBox.top,
                width: panelCardBox.width,
                maxHeight: panelCardBox.maxHeight,
              }}
            >
              <div
                className={`${cardClass} max-h-full w-full overflow-hidden`}
                style={{
                  maxHeight: panelCardBox.maxHeight,
                  paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))',
                }}
                role="dialog"
                aria-labelledby="onboarding-step-title"
              >
                {cardInner}
              </div>
            </div>
            <div
              className="pointer-events-none absolute z-[2] text-amber-400 drop-shadow-lg"
              style={{
                left: panelArrowLeft,
                top: Math.max(
                  gap,
                  Math.min(rect.top + rect.height / 2 - 16, vh - gap - 32)
                ),
                fontSize: 28,
                lineHeight: 1,
              }}
              aria-hidden
            >
              ▶
            </div>
          </>
        ) : (
          <div
            className={`absolute z-[2] ${cardClass} max-h-[min(55vh,480px)] overflow-hidden`}
            style={{
              left: tipLeft,
              top: tipTop,
              width: cardMax,
              maxWidth: 420,
            }}
            role="dialog"
            aria-labelledby="onboarding-step-title"
          >
            {cardInner}
          </div>
        )}
      </div>,
      document.body
    );
  }, [tourOpen, rect, step, stepIndex, narrow, closeTour, nextStep, prevStep, skipMissingAndNext, layoutKey]);

  const introModal =
    introOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4 bg-black/60" role="dialog">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-gray-600 bg-gray-900 p-6 text-white shadow-2xl">
              <h2 className="text-xl font-bold text-white mb-2">Тур для новых пользователей</h2>
              <p className="text-sm text-gray-200 leading-relaxed">
                Тур подсветит кнопки и покажет, в каком порядке: рисовать зону, размещать дрона, строить маршрут и использовать шаблоны.
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
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
                  Начать тур
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
          className="absolute bottom-[5.5rem] left-4 z-[1400] flex h-14 w-14 items-center justify-center rounded-full border-2 border-amber-400 bg-amber-500 text-2xl font-black text-gray-900 shadow-lg shadow-amber-900/40 animate-pulse hover:animate-none hover:bg-amber-400 lg:bottom-8"
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
