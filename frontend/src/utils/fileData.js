/**
 * 20-11-2026: a chosen file → base64 for files.php. A photo is made smaller first (longest side ≤ max px, JPEG),
 * so a 6 MB phone photo goes as ~300 KB; other files go as they are.
 */
export const isImage = (type, name = '') => /^image\/(jpeg|png|webp|gif)$/.test(type || '') || /\.(jpe?g|png|webp|gif)$/i.test(name);

export function readBase64(file) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => no(new Error('The file cannot be read'));
    r.readAsDataURL(file);
  });
}

/** photo → { name, data } as JPEG (GIF and small photos stay as they are) */
export async function shrinkImage(file, max = 1600, quality = 0.82, keepBelow = 350_000) {
  if (/gif$/i.test(file.type) || (file.size <= keepBelow && max >= 1600)) return { name: file.name, data: await readBase64(file) };
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('The photo cannot be read')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)); const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    const data = c.toDataURL('image/jpeg', quality).replace(/^data:[^,]*,/, '');
    return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', data };
  } finally { URL.revokeObjectURL(url); }
}

/** square crop for a profile picture → JPEG base64 (size × size) */
export async function squareImage(file, size = 256) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('The photo cannot be read')); i.src = url; });
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
    g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.85).replace(/^data:[^,]*,/, '');
  } finally { URL.revokeObjectURL(url); }
}

export const fmtSize = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
