export function isPointInsideZoneBoundary(boundary, point) {
  if (!Array.isArray(boundary) || boundary.length < 4 || !point) return false;
  const px = Number(point.lng);
  const py = Number(point.lat);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;

  const vertices = boundary.slice(0, -1);
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects =
      (yi > py) !== (yj > py) &&
      px < ((xj - xi) * (py - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
export function normalizeZoneName(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

export function nextZoneOrdinal(zones) {
  const list = Array.isArray(zones) ? zones : [];
  let max = 0;
  for (const z of list) {
    const name = String(z?.name ?? '').trim();
    const m = name.match(/^Зона\s*№\s*(\d+)/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

export function zoneColorNameFromHex(colorHex = '#22c55e') {
  const m = String(colorHex).trim().match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return 'цветной';
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  if (s < 0.1) {
    if (l <= 0.1) return 'чёрный';
    if (l >= 0.94) return 'белый';
    if (l >= 0.82) return 'светло-серый';
    if (l <= 0.25) return 'тёмно-серый';
    return 'серый';
  }

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const tonePrefix = l <= 0.28 ? 'тёмно-' : l >= 0.78 ? 'светло-' : '';
  let base = 'цветной';
  if (h < 15 || h >= 345) base = 'красный';
  else if (h < 38) base = 'оранжевый';
  else if (h < 52) base = 'янтарный';
  else if (h < 68) base = 'жёлтый';
  else if (h < 95) base = 'лаймовый';
  else if (h < 150) base = 'зелёный';
  else if (h < 170) base = 'мятный';
  else if (h < 190) base = 'бирюзовый';
  else if (h < 212) base = 'голубой';
  else if (h < 228) base = 'лазурный';
  else if (h < 255) base = 'синий';
  else if (h < 272) base = 'индиго';
  else if (h < 295) base = 'фиолетовый';
  else if (h < 320) base = 'пурпурный';
  else if (h < 345) base = 'розовый';
  return `${tonePrefix}${base}`;
}

export function buildAutoZoneName(zones, colorHex = '#22c55e') {
  let ord = nextZoneOrdinal(zones);
  const colorName = zoneColorNameFromHex(colorHex);
  const existing = new Set((Array.isArray(zones) ? zones : []).map((z) => normalizeZoneName(z?.name)));
  while (existing.has(normalizeZoneName(`Зона №${ord}("${colorName}")`))) {
    ord += 1;
  }
  return `Зона №${ord}("${colorName}")`;
}

export function updateAutoZoneNameColor(name, colorHex = '#22c55e') {
  const m = String(name ?? '').trim().match(/^Зона\s*№\s*(\d+)\(".*"\)$/i);
  if (!m) return null;
  const ord = Number(m[1]);
  if (!Number.isFinite(ord)) return null;
  return `Зона №${ord}("${zoneColorNameFromHex(colorHex)}")`;
}
