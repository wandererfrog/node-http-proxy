import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import './style.css';

// Render at device resolution (capped for performance) so pixel art and text stay crisp on phones.
const dpr = Math.min(window.devicePixelRatio || 1, 2);
const size = () => ({ w: Math.round(window.innerWidth * dpr), h: Math.round(window.innerHeight * dpr) });
const { w, h } = size();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: w,
  height: h,
  pixelArt: true,
  backgroundColor: '#1a1c2c',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: 3 },
  // Use real frame time so slow phones don't run the game in slow motion.
  fps: { smoothStep: false },
  callbacks: {
    preBoot: (g) => g.registry.set('dpr', dpr),
  },
  scene: [GameScene],
});

const onResize = () => {
  const s = size();
  game.scale.resize(s.w, s.h);
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

// Block the browser's own gestures (pull-to-refresh, double-tap zoom, long-press menus).
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// Expose for debugging and automated smoke tests.
(window as unknown as { game: Phaser.Game }).game = game;
