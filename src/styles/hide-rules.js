/**
 * hide-rules.js — maps each storage key to the CSS selectors that hide that element.
 *
 * Selectors target current YouTube markup and will need occasional maintenance as
 * YouTube updates its DOM. All tuning is isolated here; no control-flow changes needed.
 *
 * @type {Record<string, string[]>}
 */
const HIDE_RULES = {
  /**
   * Recommendation sidebar — the entire #secondary column on watch pages
   * (holds suggested videos, autoplay, etc.)
   */
  hideRecommendationSidebar: [
    '#secondary',
    '#secondary-inner',
  ],

  /**
   * Up next / autoplay panel — the autoplay countdown and next-video card.
   * Targets both the in-sidebar renderer and the end-screen upnext overlay.
   */
  hideUpNextAutoplay: [
    'ytd-compact-autoplay-renderer',
    '.ytp-autonav-endscreen-upnext-container',
    'ytd-autoplay-component',
  ],

  /**
   * End screen cards and annotations — the overlay cards and legacy annotations
   * that appear in the last 20 seconds of a video.
   */
  hideEndScreenCards: [
    '.ytp-ce-element',
    '.ytp-endscreen-content',
    '.ytp-cards-teaser',
    '.ytp-cards-button',
    '.annotation',
  ],

  /**
   * Shorts shelf — horizontal Shorts rows on the homepage, search results,
   * and subscription feed. Covers current and recent YouTube markup variants.
   */
  hideShortsShelf: [
    'ytd-rich-shelf-renderer[is-shorts]',
    'ytd-reel-shelf-renderer',
    'ytm-shorts-lockup-view-model',
    'grid-shelf-view-model',
    'ytd-guide-entry-renderer a[title="Shorts"]',
    'ytd-mini-guide-entry-renderer a[title="Shorts"]',
  ],

  /**
   * Comments section — the full comments thread below a video.
   */
  hideComments: [
    '#comments',
    'ytd-comments',
  ],

  /**
   * Homepage feed — the main content grid on youtube.com (the homepage).
   * CSS-hides the feed container; the content script also does a DOM replacement
   * for a cleaner result when this toggle is on.
   */
  hideHomepageFeed: [
    'ytd-browse[page-subtype="home"] #contents.ytd-rich-grid-renderer',
    'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
  ],
};
