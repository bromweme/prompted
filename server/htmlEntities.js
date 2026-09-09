// Decode-only HTML entity conversion.
//
// The YouTube Data API returns snippet text HTML-escaped: a video actually
// titled  Queen - "Bohemian Rhapsody" (Freddie's take)  arrives as
//   Queen - &quot;Bohemian Rhapsody&quot; (Freddie&#39;s take)
// and, rendered as a React text node, shows those entities literally.
//
// This is deliberately a plain string -> string transform over a fixed table,
// not an HTML parser and not a DOM round-trip. It never interprets markup, so
// it cannot reintroduce the injection risk the security audit closed:
//   - no innerHTML / dangerouslySetInnerHTML anywhere in the path
//   - tags in the source survive as literal text ("&lt;b&gt;" -> "<b>"), and
//     React escapes them again on render, so they display as characters
//   - one pass only, so "&amp;lt;" decodes to the literal text "&lt;" rather
//     than being re-decoded into a tag
//
// The named set is small on purpose: these are the entities an HTML escaper
// actually produces. Everything else arrives as a numeric reference, which the
// numeric branch handles in full.

const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

// &name; | &#1234; | &#x1F600;
const ENTITY = /&(?:([a-zA-Z][a-zA-Z0-9]{1,31})|#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g;

function fromCodePoint(code) {
  // Reject what String.fromCodePoint would throw on, plus lone surrogates,
  // which are not text and would corrupt anything downstream that re-encodes.
  if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

/**
 * Decodes HTML entities in a string. Anything that is not a string, or is not
 * a recognised entity, comes back untouched — an unknown "&foo;" stays "&foo;"
 * rather than being guessed at or dropped.
 */
function decodeHtmlEntities(value) {
  if (typeof value !== 'string' || !value.includes('&')) return value;

  return value.replace(ENTITY, (match, name, dec, hex) => {
    if (name) {
      return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : match;
    }
    const decoded = fromCodePoint(parseInt(dec || hex, dec ? 10 : 16));
    return decoded === null ? match : decoded;
  });
}

module.exports = { decodeHtmlEntities };
