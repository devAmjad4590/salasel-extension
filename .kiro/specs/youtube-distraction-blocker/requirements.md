# Requirements — YouTube Distraction Blocker (v1)

## Introduction

This feature is the v1 of the Salasel Extension: a Manifest V3 browser extension that
lets a user hide individual YouTube distraction elements. Each distraction is controlled
by its own toggle in a popup UI, and each preference is persisted independently in
`chrome.storage.sync`. All toggles default to OFF, so YouTube is untouched until the user
opts into hiding something. Hiding is implemented via injected CSS and kept consistent
across YouTube's single-page-app navigation using a MutationObserver.

## Requirements

### Requirement 1 — Per-element distraction toggles

**User Story:** As a YouTube user, I want a separate toggle for each distraction element,
so that I can hide only the parts of YouTube I find distracting and keep the rest.

#### Acceptance Criteria

1. WHEN the user opens the popup THEN the system SHALL display six independent toggles:
   recommendation sidebar, up next / autoplay, end screen cards & annotations, Shorts
   shelf, comments, and homepage feed.
2. WHEN the user changes one toggle THEN the system SHALL NOT change the state of any other
   toggle.
3. WHEN a toggle is enabled THEN the system SHALL hide the corresponding element on YouTube.
4. WHEN a toggle is disabled THEN the system SHALL show the corresponding element on YouTube.

### Requirement 2 — Independent persistence in chrome.storage.sync

**User Story:** As a user with multiple devices, I want my toggle choices saved and synced,
so that my preferences follow me across signed-in browsers.

#### Acceptance Criteria

1. WHEN the user changes a toggle THEN the system SHALL persist that single preference to
   `chrome.storage.sync` under its own key without overwriting other keys.
2. WHEN the popup opens THEN the system SHALL read the current preferences from
   `chrome.storage.sync` and render each toggle in its saved state.
3. WHEN a preference key is missing from storage THEN the system SHALL treat it as its
   default value.
4. WHEN preferences are read THEN the system SHALL key each toggle as a boolean where
   `true` means the element is hidden.

### Requirement 3 — Off-by-default behavior

**User Story:** As a new user, I want the extension to leave YouTube untouched until I
choose otherwise, so that nothing disappears unexpectedly after install.

#### Acceptance Criteria

1. WHEN the extension is installed and no preferences exist THEN the system SHALL treat all
   six toggles as `false` (element visible).
2. WHEN no preference has been changed THEN the system SHALL NOT hide any YouTube element.

### Requirement 4 — Hide via CSS injection

**User Story:** As a user, I want hidden elements to disappear cleanly and instantly, so
that the page does not flicker or break.

#### Acceptance Criteria

1. WHEN an element must be hidden THEN the system SHALL hide it by injecting a managed
   `<style>` tag into the page rather than removing DOM nodes.
2. WHEN the set of enabled toggles changes THEN the system SHALL rebuild the managed
   `<style>` contents from the currently-enabled toggles.
3. WHEN a toggle is disabled THEN the system SHALL remove that element's rule from the
   managed `<style>` so the element becomes visible again without a page reload.

### Requirement 5 — Persistence across SPA navigation

**User Story:** As a user navigating YouTube, I want my hidden elements to stay hidden when
I move between pages, so that distractions don't reappear during a browsing session.

#### Acceptance Criteria

1. WHEN YouTube performs SPA navigation (no full reload) THEN the system SHALL keep the
   managed `<style>` tag present in the document.
2. IF YouTube removes or replaces the managed `<style>` tag THEN the system SHALL re-insert
   it via a MutationObserver.
3. WHEN the MutationObserver fires THEN the system SHALL perform minimal work, re-asserting
   the style tag and re-evaluating the homepage condition rather than re-scanning the DOM.

### Requirement 6 — Apply preferences on load

**User Story:** As a user, I want my saved preferences applied as soon as a YouTube page
loads, so that distractions are hidden before I see them.

#### Acceptance Criteria

1. WHEN the content script loads on a YouTube page THEN the system SHALL read preferences
   from `chrome.storage.sync` and build the managed `<style>` immediately.
2. WHEN a toggle is changed in the popup THEN the system SHALL update open YouTube tabs via
   `chrome.storage.onChanged` without requiring a page reload.

### Requirement 7 — Homepage feed replacement

**User Story:** As a user, I want the YouTube homepage replaced with a clean empty page when
I enable that toggle, so that I land on a calm screen instead of a feed.

#### Acceptance Criteria

1. WHEN the homepage feed toggle is enabled AND the user is on `youtube.com` directly THEN
   the system SHALL replace the feed with a clean empty page.
2. WHEN the homepage feed toggle is disabled THEN the system SHALL show the normal YouTube
   homepage.
3. WHEN the user navigates away from the homepage THEN the system SHALL NOT apply the empty
   page to non-homepage routes.

### Requirement 8 — Platform and tech constraints

**User Story:** As a maintainer, I want the extension to follow MV3 and stay lightweight,
so that it is publishable and easy to maintain.

#### Acceptance Criteria

1. WHEN the extension is built THEN the system SHALL use Manifest V3.
2. WHEN the manifest declares permissions THEN the system SHALL request only `storage` and
   host access to YouTube.
3. WHEN code is written THEN the system SHALL use vanilla JS with no runtime framework and
   no required build step.
4. WHEN targeting browsers THEN the system SHALL work on current Chrome/Chromium; Firefox
   support is a stretch goal and not a release blocker.
