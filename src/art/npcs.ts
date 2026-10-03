import type Phaser from 'phaser';
import type { NpcDef } from '../entities/quests';

/**
 * Villager sprites: the archer's idle frame with its green hood and cloak recoloured to the
 * villager's own colour (purple for the Elder, red for the merchant, blue for the warden), so each
 * reads as a different person in the same pixel style. Built once per villager at boot.
 */

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Texture key of a villager's sprite (made on first use). */
export function npcTexture(scene: Phaser.Scene, def: NpcDef): string {
  const key = `npc_${def.id}`;
  if (scene.textures.exists(key)) return key;
  const f = scene.textures.getFrame('archer', 'down_idle');
  const c = document.createElement('canvas');
  c.width = f.cutWidth;
  c.height = f.cutHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(f.source.image as HTMLImageElement, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    // Greens (the hood, cloak and tunic trim) take the villager's colour; skin, leather and outline stay.
    if (h < 65 || h > 175 || s < 0.12) continue;
    const [r, g, b] = hslToRgb(def.hue, Math.min(1, s * 1.05), Math.max(0, Math.min(1, l + def.light)));
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(key, c);
  return key;
}

/** A villager's sprite as a data URL (hard pixels, 3x) for the dialog portrait. */
export function npcPortraitUrl(scene: Phaser.Scene, def: NpcDef): string {
  const key = npcTexture(scene, def);
  const src = scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
  const c = document.createElement('canvas');
  c.width = src.width * 3;
  c.height = src.height * 3;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL();
}
