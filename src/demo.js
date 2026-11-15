import { createConstellation, addStar, toggleEdge } from './project.js';

// Build two demo constellations from the regenerated star field by picking
// bright stars near requested anchor points, then linking them in order.
function nearestBrightStars(stars, anchors, count) {
  const picked = [];
  const used = new Set();
  for (const anchor of anchors) {
    let best = null;
    let bestScore = Infinity;
    for (const star of stars) {
      if (used.has(star.id)) continue;
      const distance = Math.hypot(star.x - anchor.x, star.y - anchor.y);
      // Distance dominates; magnitude only breaks ties between nearby stars.
      const score = distance * 1.4 + star.magnitude * 6;
      if (score < bestScore) {
        bestScore = score;
        best = star;
      }
    }
    if (best) {
      used.add(best.id);
      picked.push(best);
    }
  }
  return picked.slice(0, count);
}

export function buildDemoConstellations(stars) {
  // Seven-star ladle across the upper-left sky.
  const ladleAnchors = [
    { x: -560, y: 320 }, { x: -430, y: 360 }, { x: -300, y: 330 },
    { x: -190, y: 250 }, { x: -240, y: 130 }, { x: -360, y: 90 },
    { x: -480, y: 150 },
  ];
  const ladleStars = nearestBrightStars(stars, ladleAnchors, 7);
  const ladle = createConstellation({
    id: 'demo_ladle',
    name: '北斗七星',
    color: '#7dd3fc',
    magRange: [-1.5, 7],
  });
  ladleStars.forEach((star) => addStar(ladle, star.id));
  for (let i = 0; i < ladleStars.length - 1; i += 1) {
    toggleEdge(ladle, ladleStars[i].id, ladleStars[i + 1].id);
  }
  // Close the bowl: star 3 -> star 6 (indexes 3 and 6 in the ladle path).
  if (ladleStars.length === 7) {
    toggleEdge(ladle, ladleStars[3].id, ladleStars[6].id);
  }

  // Triangle in the lower-right sky.
  const triAnchors = [
    { x: 260, y: -180 }, { x: 470, y: -320 }, { x: 430, y: -80 },
  ];
  const triStars = nearestBrightStars(stars, triAnchors, 3);
  const triangle = createConstellation({
    id: 'demo_triangle',
    name: '三角座',
    color: '#f0abfc',
    magRange: [0, 5.5],
  });
  triStars.forEach((star) => addStar(triangle, star.id));
  for (let i = 0; i < triStars.length; i += 1) {
    toggleEdge(triangle, triStars[i].id, triStars[(i + 1) % triStars.length].id);
  }

  return [ladle, triangle];
}
