/**
 * Contact address assembly for the long-form pages.
 *
 * Kept out of the main bundle: these pages need none of the engine, GSAP, or the badge, and a
 * privacy policy that pulls 150kb of animation library to render a paragraph would be its own
 * small joke.
 */
const a = document.getElementById('mailLink');
const text = document.getElementById('mailText');
if (a && text) {
  const addr = `${a.dataset.u}@${a.dataset.d}`;
  a.href = `mailto:${addr}`;
  text.textContent = addr;
}
