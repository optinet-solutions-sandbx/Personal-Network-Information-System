// Client-side image helpers shared by the contact composer and the notes
// section. Browser-only (FileReader / canvas) — import from client components.

// Longest edge we downscale photos to before upload — keeps the request small
// (and within the serverless body limit) without hurting OCR of the vision model.
export const MAX_IMAGE_DIM = 1568;

// How many photos a single note accepts (mirrors LIMITS.noteImageCount).
export const MAX_NOTE_IMAGES = 4;

// Read an image File and return a (possibly downscaled) data URL. Large photos
// are re-encoded as JPEG via a canvas; small ones pass through untouched.
export async function fileToDataUrl(file: File): Promise<string> {
  const original = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("decode failed"));
    i.src = original;
  });

  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
  // Already small enough and not huge on disk — keep the original bytes.
  if (scale === 1 && original.length < 1_500_000) return original;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  // Flatten onto white so transparent PNGs don't turn black as JPEG.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}
