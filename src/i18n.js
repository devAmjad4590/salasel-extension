/**
 * i18n.js — UI translation dictionary and helpers, shared by popup and content
 * script. Vanilla, no build step. Arabic ('ar') is the default language.
 *
 * This is UI localization only — it does NOT translate YouTube content or
 * subtitles (that remains a deferred feature in the product steering doc).
 */

'use strict';

/** Default UI language. */
const I18N_DEFAULT_LANG = 'ar';

/** Supported language codes, in display order for the switcher. */
const I18N_LANGS = ['ar', 'en'];

/**
 * Translation tables. Keys are stable identifiers referenced from markup via
 * data-i18n attributes and from JS via t(lang, key).
 */
const TRANSLATIONS = {
  ar: {
    appName:        'سلاسل',
    brandTag:       'مرافق التركيز',
    statusAllOff:   'الكل ظاهر',
    statusHidden:   '{n} / {total} مخفي',

    sidebarTitle:   'الشريط الجانبي للتوصيات',
    sidebarDesc:    'إخفاء لوحة الفيديوهات المقترحة في صفحات المشاهدة',
    upnextTitle:    'التالي / التشغيل التلقائي',
    upnextDesc:     'إخفاء العد التنازلي للتشغيل التلقائي وبطاقة الفيديو التالي',
    endscreenTitle: 'بطاقات نهاية الفيديو والتعليقات التوضيحية',
    endscreenDesc:  'إخفاء البطاقات والتعليقات التوضيحية في نهاية الفيديو',
    shortsTitle:    'رف الشورتس',
    shortsDesc:     'إزالة صفوف الشورتس من الصفحة الرئيسية ونتائج البحث',
    commentsTitle:  'قسم التعليقات',
    commentsDesc:   'إخفاء قسم التعليقات أسفل الفيديو بالكامل',
    homeTitle:      'خلاصة الصفحة الرئيسية',
    homeDesc:       'استبدال الصفحة الرئيسية لليوتيوب بصفحة فارغة نظيفة',

    footer:         'جزء من سلاسل',
    langLabel:      'اللغة',

    phBadge:        'محظور بواسطة سلاسل',
    phTitle:        'خلاصة الصفحة الرئيسية متوقفة',
    phSubtitle:     'أوقفت هذا للبقاء مركّزًا. ابحث عن شيء محدد، أو توجّه إلى قوائم التشغيل الخاصة بك.',
    phHint:         'لإعادة تشغيلها، انقر على أيقونة إضافة سلاسل.',
  },

  en: {
    appName:        'Salasel',
    brandTag:       'Focus companion',
    statusAllOff:   'All visible',
    statusHidden:   '{n} / {total} hidden',

    sidebarTitle:   'Recommendation sidebar',
    sidebarDesc:    'Hides suggested videos panel on watch pages',
    upnextTitle:    'Up next / autoplay',
    upnextDesc:     'Hides the autoplay countdown and next-video card',
    endscreenTitle: 'End screen cards & annotations',
    endscreenDesc:  'Hides overlay cards and annotations at end of videos',
    shortsTitle:    'Shorts shelf',
    shortsDesc:     'Removes Shorts rows from homepage and search results',
    commentsTitle:  'Comments section',
    commentsDesc:   'Hides the entire comments thread below videos',
    homeTitle:      'Homepage feed',
    homeDesc:       'Replaces the YouTube homepage with a clean empty page',

    footer:         'Part of Salasel',
    langLabel:      'Language',

    phBadge:        'Blocked by Salasel',
    phTitle:        'Homepage feed is off',
    phSubtitle:     'You turned this off to stay focused. Search for something specific, or head to your playlists.',
    phHint:         'To turn it back on, click the Salasel extension icon.',
  },
};

/**
 * Translate a key for a given language, falling back to the default language
 * and finally to the key itself. Supports {placeholder} interpolation.
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
function t(lang, key, vars) {
  const table = TRANSLATIONS[lang] || TRANSLATIONS[I18N_DEFAULT_LANG];
  let str = (table && table[key]) || TRANSLATIONS[I18N_DEFAULT_LANG][key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
    }
  }
  return str;
}

/** True if the language is right-to-left. */
function isRTL(lang) {
  return lang === 'ar';
}
