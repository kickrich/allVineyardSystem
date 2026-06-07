import { isPointInsideZoneBoundary } from './zone_Geometry.js';

export function normalizedTemplatePoints(path) {
  return Array.isArray(path)
    ? path.filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    : [];
}

export function inferZoneIdForTemplatePath(path, zones) {
  const points = normalizedTemplatePoints(path);
  if (!Array.isArray(zones) || zones.length === 0) return null;
  if (zones.length === 1) {
    const onlyZoneId = zones[0]?.id;
    return onlyZoneId == null ? null : onlyZoneId;
  }
  if (points.length < 2) return null;

  let bestZoneId = null;
  let bestHits = 0;
  for (const z of zones) {
    const boundary = z?.boundary;
    const zid = z?.id;
    if (zid == null || !Array.isArray(boundary) || boundary.length < 4) continue;
    let hits = 0;
    for (const [lat, lng] of points) {
      if (isPointInsideZoneBoundary(boundary, { lat, lng })) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestZoneId = zid;
    }
  }
  if (bestZoneId != null && bestHits >= 1) return bestZoneId;
  return null;
}

export function templateTouchesZone(templatePath, zoneBoundary) {
  const points = normalizedTemplatePoints(templatePath);
  if (!points.length || !Array.isArray(zoneBoundary) || zoneBoundary.length < 4) return false;
  return points.some(([lat, lng]) => isPointInsideZoneBoundary(zoneBoundary, { lat, lng }));
}

export function collectSameZoneTemplateIds(templateId, templates, zones) {
  const list = Array.isArray(templates) ? templates : [];
  const zlist = Array.isArray(zones) ? zones : [];
  const base = list.find((t) => t.id === templateId);
  if (!base) return [];
  const resolveTemplateZoneId = (tpl) =>
    tpl?.zoneId ?? inferZoneIdForTemplatePath(tpl?.path, zlist);
  const baseZoneId = resolveTemplateZoneId(base);
  const baseBoundary =
    baseZoneId == null
      ? null
      : zlist.find((z) => String(z.id) === String(baseZoneId))?.boundary ?? null;

  return list
    .filter((t) => {
      if (baseZoneId == null) return t.id === templateId;
      const zId = resolveTemplateZoneId(t);
      if (zId != null && String(zId) === String(baseZoneId)) return true;
      return templateTouchesZone(t?.path, baseBoundary);
    })
    .map((t) => t.id);
}
export function nextRouteTemplateOrdinal(templates) {
  const list = Array.isArray(templates) ? templates : [];
  let max = 0;
  for (const t of list) {
    const name = String(t?.name ?? '').trim();
    const m = name.match(/^Маршрут\s*№\s*(\d+)/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

export function buildAutoRouteTemplateName(templates) {
  let ord = nextRouteTemplateOrdinal(templates);
  const existing = new Set((Array.isArray(templates) ? templates : []).map((t) => String(t?.name ?? '').trim().toLocaleLowerCase()));
  while (existing.has(`маршрут №${ord}`.toLocaleLowerCase())) ord += 1;
  return `Маршрут №${ord}`;
}

export function mapBackendTemplateToFrontend(template) {
  const id = template?.id;
  const rawPath = Array.isArray(template?.path) ? template.path : [];
  const rawShiftSegments = Array.isArray(template?.shift_segment_indices)
    ? template.shift_segment_indices
    : (Array.isArray(template?.shiftSegments) ? template.shiftSegments : []);
  return {
    id: id != null ? String(id) : `tpl_${Date.now()}`,
    name: template?.name || 'Без названия',
    path: rawPath
      .map((point) => (Array.isArray(point) && point.length >= 2 ? [Number(point[0]), Number(point[1])] : null))
      .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])),
    zoneId: template?.zone_id ?? template?.zoneId ?? null,
    shiftSegments: [...new Set(rawShiftSegments
      .map((i) => Number(i))
      .filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b),
  };
}
