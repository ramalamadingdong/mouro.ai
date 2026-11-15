# Changelog

## 2026-11-15: site content update and interest lenses

Branch `site/2026-content-update`. Portfolio pages only; the games, the
realtime server and `infra/` are untouched.

### Changed

- **Home**
  - Title, description and link-preview text now carry the current role: Lead
    Robotics / Physical AI Staff Software Engineer, Developer Relations at
    Qualcomm.
  - New hero bio. The tagline is removed.
  - About rewritten as a year-level timeline: Colorado, CU Boulder,
    Colorado Army National Guard 2017 to 2023, Qualcomm roles through 2026,
    FIRST roles, FRC Team 2972 at the Dawson School.
  - Current focus list replaced.
  - Selected work reordered and extended: Pi0.5 VLA on Dragonwing NPU (lead),
    PCB Agent (updated), FIRST Agentic CSA (updated), FIRST and K-12 robotics
    at Qualcomm (new), Edge AI demos (new), then the existing cards, plus a
    pointer to "Other builds and earlier work".
  - New Talks and events section (13 rows) and Awards section.
- **Projects**
  - New write-ups: Pi0.5 VLA on Dragonwing NPU, FIRST and K-12 robotics at
    Qualcomm, Edge AI demos.
  - New "Other builds and earlier work" grid.
  - PCB Agent: plugin commands, idempotent passes, sign-off gates, gerber-check,
    and "6 board designs manufactured" in place of the not-fabricated line.
  - FIRST Agentic CSA: "3,000+ users" replaces the PulseMCP visitor count; the
    3,600+ figure now reads as the size of the FRC community.
- **PCB article**
  - The lines saying the example board was not fabricated are gone.
  - A dated update note (November 15, 2026) says 6 board designs have been
    manufactured with the pipeline.
- **Interest lenses** on Home and Projects
  - Chips for All, Robotics / Physical AI, DevRel and community, Product and
    partnerships, Agentic AI tooling, Embedded and hardware.
  - `?lens=<value>` reorders and highlights the same cards and swaps the hero
    line. Nothing is removed, and every fact is identical in every lens.
  - `site/static/js/lens.js` (54 lines, no dependencies). Without JavaScript
    the chips stay hidden and the page is the complete default view.
  - Cards outside the lens turn steel grey (about 5.7:1 on light, 7:1 on dark)
    and stay fully clickable.
- **SEO**: `<link rel="canonical">` on Home and Projects. There is no sitemap.
- **Link previews**: home and projects cards re-rendered; new cards and share
  addresses for `/projects/pi05/`, `/projects/first-k12/` and
  `/projects/edge-ai-demos/`.

### Still waiting on Rami

- **The 6 manufactured boards**: names, fab house, bring-up results, photos.
  The site only says "6 board designs manufactured". It does not say whether
  the example UNO Q shield is one of them.
- **CornerIQ**: left off the site until cleared.
- **Governor Cup**: listed once, as the 2026 event at Constitution Hall. No
  exact date yet.
- **Talk recordings**: no video or post links added beyond the two that were
  already on the site.
- **Dead link, already on the live site**: the DD Form 1750 "View sample usage"
  Google Drive link returns 404. Left as is.
