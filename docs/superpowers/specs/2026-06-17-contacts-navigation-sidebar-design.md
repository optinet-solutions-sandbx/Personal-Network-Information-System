# Contacts Navigation Sidebar — Design Spec

**Date:** 2026-06-17
**Status:** Approved

## Summary

Integrate the existing `ContactsSidebar` component into the app layout so it appears on all pages, and repurpose the home page as a focused "Add Contact" view by removing its redundant contact list.

## Goals

- Give users persistent, one-click navigation between any contact from any page
- Remove the redundant contact list on the home page (the sidebar takes over that role)
- No new components required — wire up what already exists

## Changes

### 1. `app/layout.tsx` — Add sidebar to shell

- Add `ContactsSidebar` as a client import
- Wrap the existing `<main>` content area in a `flex flex-row h-full` container
- Sidebar goes on the left (fixed 224px / `w-56`), main content fills the rest
- Top header stays full-width above both
- The sidebar is visible on every page including the home (add contact) page

### 2. `app/HomePageClient.tsx` — Strip contact list

- Remove: search input, debounced search state, contact list grid, ContactCard display, and any related handlers
- Keep: the story extraction form, AI field review/editing, and save flow
- The page title/heading should reflect the new purpose ("Add Contact" or similar)
- Estimated removal: ~200 lines

### 3. `components/ContactsSidebar.tsx` — No changes

- Component is complete. The "+ Add" button already links to `/`.

## Non-Goals

- Sidebar redesign or new features (search, avatars, active state all work)
- Mobile/responsive handling (out of scope for this iteration)
- Any changes to the contact detail page layout

## Success Criteria

- Sidebar renders on `/` (home) and `/contacts/[id]` (detail)
- Active contact is highlighted in the sidebar on detail pages
- Home page shows only the add-contact form
- No contact list duplication anywhere in the UI
