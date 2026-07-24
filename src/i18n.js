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

    sidebarTitle:   'إخفاء الشريط الجانبي للتوصيات',
    sidebarDesc:    'إخفاء لوحة الفيديوهات المقترحة في صفحات المشاهدة',
    upnextTitle:    'إخفاء التالي / التشغيل التلقائي',
    upnextDesc:     'إخفاء العد التنازلي للتشغيل التلقائي وبطاقة الفيديو التالي',
    endscreenTitle: 'إخفاء بطاقات نهاية الفيديو والتعليقات التوضيحية',
    endscreenDesc:  'إخفاء البطاقات والتعليقات التوضيحية في نهاية الفيديو',
    shortsTitle:    'إخفاء رف الشورتس',
    shortsDesc:     'إزالة صفوف الشورتس من الصفحة الرئيسية ونتائج البحث',
    commentsTitle:  'إخفاء قسم التعليقات',
    commentsDesc:   'إخفاء قسم التعليقات أسفل الفيديو بالكامل',
    homeTitle:      'إخفاء خلاصة الصفحة الرئيسية',
    homeDesc:       'استبدال الصفحة الرئيسية لليوتيوب بصفحة فارغة نظيفة',

    footer:         'جزء من سلاسل',
    langLabel:      'اللغة',

    cwEyebrow:      'سلاسل',
    cwHeading:      'تواصل المشاهدة',
    cwContinue:     'متابعة',
    cwDismiss:      'إخفاء',

    phBadge:        'محظور بواسطة سلاسل',
    phTitle:        'خلاصة الصفحة الرئيسية متوقفة',
    phSubtitle:     'أوقفت هذا للبقاء مركّزًا. ابحث عن شيء محدد، أو توجّه إلى قوائم التشغيل الخاصة بك.',
    phHint:         'لإعادة تشغيلها، انقر على أيقونة إضافة سلاسل.',

    notesButton:     'ملاحظات سلاسل',
    notesTitle:      'ملاحظاتي',
    notesPlaceholder:'اكتب ملاحظاتك حول هذا الفيديو…',
    notesClose:      'إغلاق',
    notesSaved:      'تم الحفظ',
    notesSaving:     'جارٍ الحفظ…',
    notesDownloadVideo:    'تنزيل ملاحظات الفيديو',
    notesDownloadPlaylist: 'تنزيل ملاحظات قائمة التشغيل',
    notesNoVideo:    'افتح فيديو لبدء تدوين الملاحظات.',
    notesNoteEmpty:  'لا توجد ملاحظات لتنزيلها.',
    notesPlaylistEmpty: 'لا توجد ملاحظات لقائمة التشغيل هذه.',
    notesExitFullscreen: 'اخرج من وضع ملء الشاشة لفتح الملاحظات.',
    notesSaveError:  'تعذّر حفظ الملاحظة. حاول مرة أخرى.',
    notesLoadError:  'تعذّر تحميل الملاحظات المحفوظة.',
    notesLimit:      'بلغت الحد الأقصى لطول الملاحظة.',
  },

  en: {
    appName:        'Salasel',
    brandTag:       'Focus companion',
    statusAllOff:   'All visible',
    statusHidden:   '{n} / {total} hidden',

    sidebarTitle:   'Hide recommendation sidebar',
    sidebarDesc:    'Hides suggested videos panel on watch pages',
    upnextTitle:    'Hide up next / autoplay',
    upnextDesc:     'Hides the autoplay countdown and next-video card',
    endscreenTitle: 'Hide end screen cards & annotations',
    endscreenDesc:  'Hides overlay cards and annotations at end of videos',
    shortsTitle:    'Hide Shorts shelf',
    shortsDesc:     'Removes Shorts rows from homepage and search results',
    commentsTitle:  'Hide comments section',
    commentsDesc:   'Hides the entire comments thread below videos',
    homeTitle:      'Hide homepage feed',
    homeDesc:       'Replaces the YouTube homepage with a clean empty page',

    footer:         'Part of Salasel',
    langLabel:      'Language',

    cwEyebrow:      'Salasel',
    cwHeading:      'Continue watching',
    cwContinue:     'Continue',
    cwDismiss:      'Dismiss',

    phBadge:        'Blocked by Salasel',
    phTitle:        'Homepage feed is off',
    phSubtitle:     'You turned this off to stay focused. Search for something specific, or head to your playlists.',
    phHint:         'To turn it back on, click the Salasel extension icon.',

    notesButton:     'Salasel notes',
    notesTitle:      'My notes',
    notesPlaceholder:'Write your notes about this video…',
    notesClose:      'Close',
    notesSaved:      'Saved',
    notesSaving:     'Saving…',
    notesDownloadVideo:    'Download video notes',
    notesDownloadPlaylist: 'Download playlist notes',
    notesNoVideo:    'Open a video to start taking notes.',
    notesNoteEmpty:  'No notes to download.',
    notesPlaylistEmpty: 'No notes for this playlist.',
    notesExitFullscreen: 'Exit fullscreen to open notes.',
    notesSaveError:  'Couldn’t save the note. Try again.',
    notesLoadError:  'Couldn’t load saved notes.',
    notesLimit:      'Reached the maximum note length.',
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
