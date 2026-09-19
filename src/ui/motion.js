/**
 * Framer Motion presets for the popup and options pages.
 * Source of truth: design-system/inertlink/MASTER.md §5.
 *
 * Only these two surfaces use Framer Motion. The content-script badge animates with WAAPI so no
 * library ships into the user's pages (ADR-0002).
 *
 * The house rule: motion explains, it never decorates. Enters rise, exits fall and are faster.
 * Nothing overshoots — a bouncing safety verdict reads as a toy.
 */

/** Non-overshooting spring. Deliberately not the generator's `back.out(1.4)`. */
export const springSoft = { type: 'spring', stiffness: 420, damping: 38, mass: 0.7 };

export const easeOut = [0.16, 1, 0.3, 1];
export const easeIn = [0.4, 0, 1, 1];

export const fadeUp = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: springSoft },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12, ease: easeIn } },
};

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18, ease: easeOut } },
  exit: { opacity: 0, transition: { duration: 0.12, ease: easeIn } },
};

/** Parent variant; children use `fadeUp`. */
export const listStagger = {
  animate: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
};

/** Panel expand — the one place `height: auto` is worth the layout cost. */
export const collapse = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1, transition: { duration: 0.26, ease: easeOut } },
  exit: { height: 0, opacity: 0, transition: { duration: 0.12, ease: easeIn } },
};

/**
 * Strip movement while keeping the crossfade, for `useReducedMotion()`.
 * Reduced motion reduces movement, never information.
 *
 * @param {object} variants
 * @param {boolean} reduced
 */
export function respectMotion(variants, reduced) {
  if (!reduced) return variants;
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.12 } },
    exit: { opacity: 0, transition: { duration: 0.12 } },
  };
}
