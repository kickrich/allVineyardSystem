/**
 * Авто-маршрут «между рядами»: прямоугольник по двум противоположным углам (начало / конец)
 * в локальной плоскости «восток–север» (малые расстояния).
 * Шаг вдоль ряда 0.5 м, между рядами 1.5 м.
 */

const EARTH_R_M = 6371000;
export const VINE_ROW_SPACING_M = 1.5;
export const VINE_ALONG_ROW_STEP_M = 0.5;

/** Дельта (восток м, север м) от origin к точке. */
export function latLngDeltaEnMeters(originLat, originLng, lat, lng) {
  const φ0 = (originLat * Math.PI) / 180;
  const dy = ((lat - originLat) * Math.PI) / 180 * EARTH_R_M;
  const dx = ((lng - originLng) * Math.PI) / 180 * EARTH_R_M * Math.cos(φ0);
  return { x: dx, y: dy };
}

export function enMetersDeltaToLatLng(originLat, originLng, dx, dy) {
  const φ0 = (originLat * Math.PI) / 180;
  const cos = Math.cos(φ0) || 1e-9;
  const dLat = (dy / EARTH_R_M) * (180 / Math.PI);
  const dLng = (dx / (EARTH_R_M * cos)) * (180 / Math.PI);
  return { lat: originLat + dLat, lng: originLng + dLng };
}

const POS_EPS_M = 0.08;

function pushSegMeters(acc, x0, y0, x1, y1, stepM) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return;
  const n = Math.max(1, Math.ceil(len / stepM));
  for (let s = 1; s <= n; s += 1) {
    const t = s / n;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    const last = acc[acc.length - 1];
    if (last && (x - last.x) ** 2 + (y - last.y) ** 2 < 1e-8) continue;
    acc.push({ x, y });
  }
}

/** Вертикаль между рядами — реже точки (шаг межрядья), без лишней дискретизации 0.5 м. */
function pushVerticalBetweenRows(acc, x0, y0, y1, stepM) {
  pushSegMeters(acc, x0, y0, x0, y1, stepM);
}

/** Довести до (x1,y1) по осям: горизонталь шагом вдоль ряда, вертикаль — шагом межрядья. */
function pushManhattan(acc, x0, y0, x1, y1, stepAlongRow, stepVertical) {
  if (Math.abs(x0 - x1) > 1e-6) {
    pushSegMeters(acc, x0, y0, x1, y0, stepAlongRow);
  }
  const last = acc[acc.length - 1];
  if (!last) return;
  if (Math.abs(last.x - x1) > 1e-6 || Math.abs(last.y - y1) > 1e-6) {
    pushSegMeters(acc, last.x, last.y, x1, y1, stepVertical);
  }
}

/**
 * @param {number[]} startLatLng [lat, lng]
 * @param {number[]} endLatLng [lat, lng]
 * @param {(p: { lat: number; lng: number }) => boolean} isInside
 * @returns {{ ok: true, path: number[][] } | { ok: false, error: string }}
 */
export function buildVineyardSerpentinePath(startLatLng, endLatLng, isInside) {
  const latS = Number(startLatLng?.[0]);
  const lngS = Number(startLatLng?.[1]);
  const latE = Number(endLatLng?.[0]);
  const lngE = Number(endLatLng?.[1]);
  if (![latS, lngS, latE, lngE].every(Number.isFinite)) {
    return { ok: false, error: 'Некорректные координаты начала или конца.' };
  }

  const d = latLngDeltaEnMeters(latS, lngS, latE, lngE);
  const xmin = Math.min(0, d.x);
  const xmax = Math.max(0, d.x);
  const ymin = Math.min(0, d.y);
  const ymax = Math.max(0, d.y);
  const w = xmax - xmin;
  const h = ymax - ymin;
  if (w < VINE_ALONG_ROW_STEP_M * 0.25 || h < VINE_ROW_SPACING_M * 0.25) {
    return { ok: false, error: 'Прямоугольник слишком маленький: разведите начальную и конечную точки.' };
  }

  const rowYsRaw = [];
  for (let y = ymin; y <= ymax + 1e-6; y += VINE_ROW_SPACING_M) {
    rowYsRaw.push(Math.min(ymax, Math.max(ymin, y)));
  }
  if (rowYsRaw.length === 0 || rowYsRaw[rowYsRaw.length - 1] < ymax - 1e-3) {
    rowYsRaw.push(ymax);
  }
  const rowYs = [];
  for (const y of rowYsRaw) {
    const prev = rowYs[rowYs.length - 1];
    if (prev == null || Math.abs(y - prev) > 1e-4) rowYs.push(y);
  }

  /** Первый проход вдоль x: в сторону «восточного» конца прямоугольника (можно сменить знаком dy). */
  let goRight = (Math.sign(d.x) || 1) > 0;
  const centerX = (xmin + xmax) / 2;
  const centerY = (ymin + ymax) / 2;
  const z = (0 - centerX) * d.y - (0 - centerY) * d.x;
  if (z < 0) goRight = !goRight;

  const acc = [{ x: 0, y: 0 }];

  if (Math.abs(ymin) > 1e-6) {
    pushVerticalBetweenRows(acc, 0, 0, ymin, VINE_ROW_SPACING_M);
  }

  for (let ri = 0; ri < rowYs.length; ri += 1) {
    const y = rowYs[ri];
    let cur = acc[acc.length - 1];
    if (cur && Math.abs(cur.y - y) > POS_EPS_M) {
      pushVerticalBetweenRows(acc, cur.x, cur.y, y, VINE_ROW_SPACING_M);
    }
    cur = acc[acc.length - 1];
    const xA = goRight ? xmin : xmax;
    const xB = goRight ? xmax : xmin;
    // Только горизонталь на текущей линии ряда: при cur.y≈y и cur.x≠xA (старт первого ряда и т.п.).
    // Не использовать hypot(cur,(xA,y)) — при погрешности по y получалась почти полная ширина + sweep.
    if (cur && Math.abs(cur.y - y) <= POS_EPS_M && Math.abs(cur.x - xA) > POS_EPS_M) {
      pushSegMeters(acc, cur.x, cur.y, xA, y, VINE_ALONG_ROW_STEP_M);
    }
    pushSegMeters(acc, xA, y, xB, y, VINE_ALONG_ROW_STEP_M);
    goRight = !goRight;
    if (acc.length > 25000) {
      return { ok: false, error: 'Слишком много точек: уменьшите прямоугольник.' };
    }
  }

  const lastM = acc[acc.length - 1];
  if (lastM && (Math.abs(lastM.x - d.x) > 1e-3 || Math.abs(lastM.y - d.y) > 1e-3)) {
    pushManhattan(
      acc,
      lastM.x,
      lastM.y,
      d.x,
      d.y,
      VINE_ALONG_ROW_STEP_M,
      VINE_ROW_SPACING_M
    );
  }

  const path = [];
  for (const p of acc) {
    const ll = enMetersDeltaToLatLng(latS, lngS, p.x, p.y);
    if (!isInside({ lat: ll.lat, lng: ll.lng })) {
      return {
        ok: false,
        error:
          'Сгенерированная траектория выходит за активную зону. Разместите углы глубже внутри зоны или уменьшите прямоугольник.',
      };
    }
    path.push([ll.lat, ll.lng]);
  }

  if (!isInside({ lat: latE, lng: lngE })) {
    return { ok: false, error: 'Конечная точка должна быть внутри активной зоны.' };
  }
  if (path.length) {
    path[path.length - 1] = [latE, lngE];
  }

  if (path.length < 2) {
    return { ok: false, error: 'Не удалось построить маршрут.' };
  }

  return { ok: true, path };
}
