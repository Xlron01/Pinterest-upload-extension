export const Fetcher = {
  async fetchMedia(url) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
      });
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const buffer = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type') || guessMime(url);
      const filename = deriveFilename(url, mimeType);

      return { success: true, buffer, mimeType, filename };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
};

function guessMime(url) {
  const ext = url.split('.').pop().split('?')[0].toLowerCase();
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    ogg: 'video/ogg',
    avi: 'video/x-msvideo',
  };
  return map[ext] || 'image/jpeg';
}

function deriveFilename(url, mimeType) {
  const fromUrl = url.split('/').pop().split('?')[0];
  if (fromUrl && fromUrl.includes('.')) return fromUrl;
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  return `pin-${Date.now()}.${ext}`;
}