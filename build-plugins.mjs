/**
 * Build plugins shared by the extension build and the site build.
 *
 * Kept in one file so the two builds cannot drift: a rule that strips something from one bundle
 * but not the other is worse than no rule, because it looks handled.
 */
import { readFile } from 'node:fs/promises';

/**
 * Drop `$comment` keys from the engine's reference data before bundling.
 *
 * `src/engine/data/*.json` carries substantial design notes — why a domain is deliberately absent
 * from the allowlist, how the blocklist is refreshed, which TLD tier means what. They belong in
 * the source, where the next person maintaining the list will read them.
 *
 * They do not belong in the shipped output. Those notes were reaching two places they should not:
 * the content script, which is injected into every page the user grants and has a size budget,
 * and the public landing-page bundle, where internal implementation commentary is simply
 * surface area with no upside.
 */
export const stripJsonComments = {
  name: 'strip-json-comments',
  setup(build) {
    build.onLoad({ filter: /engine[\\/]data[\\/].*\.json$/ }, async (args) => {
      const raw = await readFile(args.path, 'utf8');
      const data = JSON.parse(raw);
      const strip = (node) => {
        if (Array.isArray(node)) return node.map(strip);
        if (node && typeof node === 'object') {
          return Object.fromEntries(
            Object.entries(node)
              .filter(([k]) => k !== '$comment')
              .map(([k, v]) => [k, strip(v)])
          );
        }
        return node;
      };
      return { contents: JSON.stringify(strip(data)), loader: 'json' };
    });
  },
};

/**
 * Remove HTML comments from published markup.
 *
 * The same reasoning as above: comments explaining *why* the markup is shaped a certain way are
 * for whoever edits `site/index.html`, not for every visitor's View Source. One of them even
 * described how the contact address is hidden from scrapers, which is a pointless thing to
 * publish next to the address it is hiding.
 *
 * Conditional comments (`<!--[if ...]>`) are preserved on the off chance one is ever added.
 *
 * @param {string} html
 */
export function stripHtmlComments(html) {
  return html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\n/gm, '');
}
