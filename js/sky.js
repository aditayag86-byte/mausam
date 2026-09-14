// Living sky background — the hero visual (PRD 6.1). Slow, ambient, reduced-motion aware.
import { REDUCED_MOTION } from './util.js';

const N_CLOUDS = 5, N_STARS = 70;

export function renderSky(mood, isDay) {
  const sky = document.getElementById('sky');
  sky.dataset.mood = mood;
  sky.dataset.day = isDay ? '1' : '0';
  if (sky.childElementCount === 0) {
    const mk = (cls) => { const d = document.createElement('div'); d.className = `layer ${cls}`; return d; };
    const stars = mk('sky-stars');
    for (let i = 0; i < N_STARS; i++) {
      const s = document.createElement('span');
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 60 + '%';
      s.style.animationDelay = (Math.random() * 4).toFixed(2) + 's';
      s.style.animationDuration = (3 + Math.random() * 4).toFixed(2) + 's';
      stars.appendChild(s);
    }
    const clouds = mk('sky-clouds');
    for (let i = 0; i < N_CLOUDS; i++) {
      const c = document.createElement('div');
      c.className = 'sky-cloud';
      c.style.top = 6 + Math.random() * 42 + '%';
      c.style.transform = `scale(${0.7 + Math.random() * 0.9})`;
      c.style.animationDuration = (70 + Math.random() * 90).toFixed(0) + 's';
      c.style.animationDelay = (-Math.random() * 120).toFixed(0) + 's';
      clouds.appendChild(c);
    }
    sky.append(stars, mk('sky-sun'), mk('sky-moon'), clouds, mk('sky-rain'), mk('sky-sheet'),
      mk('sky-bolt'), mk('sky-haze'), mk('sky-fog'), mk('sky-scrim'));
  }
}
