export function contentTypeForVideoFile(file) {
  if (file.type === 'video/mp4' || file.type === 'video/webm') return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'webm') return 'video/webm';
  return 'video/mp4';
}

export function contentTypeFromCatalogItem(item, blob) {
  if (item?.content_type) return item.content_type;
  return contentTypeForVideoFile({ name: item?.name || 'video.mp4', type: blob?.type || '' });
}
