// Graphics presets. Default is LOW so phones never start hot.
export const QUALITY = {
  low: {
    id: 'low',
    label: 'Low',
    pixelRatio: 1,
    shadowMap: 1024,
    shadowRange: 22,
    particles: 160,
    particleScale: 0.55,
    fog: [30, 130],
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    pixelRatio: 1.5,
    shadowMap: 2048,
    shadowRange: 28,
    particles: 380,
    particleScale: 1,
    fog: [40, 160],
  },
  high: {
    id: 'high',
    label: 'High',
    pixelRatio: 2,
    shadowMap: 3072,
    shadowRange: 34,
    particles: 720,
    particleScale: 1.6,
    fog: [50, 190],
  },
};

export function getQuality(id) {
  return QUALITY[id] || QUALITY.low;
}
