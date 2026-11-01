import './ui/style.css';
import { Game } from './core/Game.js';

const loading = document.getElementById('loading');
const sub = document.getElementById('loading-sub');
const fatal = document.getElementById('fatal');

function showFatal(message) {
  document.getElementById('fatal-msg').textContent = message;
  fatal.hidden = false;
  loading.classList.add('done');
}
document.getElementById('fatal-reload').addEventListener('click', () => location.reload());

window.addEventListener('error', (e) => console.error('[error]', e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[promise]', e.reason));

(async () => {
  try {
    const game = await Game.create(document.getElementById('game'), document.getElementById('app'), (t) => {
      sub.textContent = t;
    });
    window.__game = game; // handy for debugging in the console
    game.start();
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 800);
  } catch (e) {
    console.error(e);
    showFatal(e && e.message ? e.message : 'Unexpected start-up error.');
  }
})();
