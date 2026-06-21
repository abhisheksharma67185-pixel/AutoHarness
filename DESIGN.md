---
name: AutoHarness Studio Design System
version: 1.0.0
author: Google Stitch AI
tokens:
  colors:
    accent:
      primary: "hsl(219, 85%, 60%)"        # Premium Cornflower Blue (#4f8dfc)
      primary_hover: "hsl(219, 85%, 50%)"  # Deep Cornflower Blue
      primary_glow: "rgba(79, 141, 252, 0.06)"
    semantic:
      success: "hsl(150, 84%, 37%)"       # Emerald Green for Promoted/Pass
      warning: "hsl(35, 92%, 50%)"        # Amber for Warnings/Pending
      danger: "hsl(343, 81%, 55%)"        # Rose Red for Rejected/Fail
      info: "hsl(217, 91%, 60%)"          # Royal Blue for Info/Documentation
    light:
      bg_base: "hsl(240, 10%, 97.5%)"     # Light grey-blue off-white
      bg_card: "hsl(0, 0%, 100%)"         # Pure white surface
      bg_card_hover: "hsl(240, 5%, 95%)"  # Soft hover grey
      foreground: "hsl(240, 10%, 12%)"    # Deep slate for primary text
      foreground_muted: "hsl(240, 5%, 45%)" # Neutral grey for secondary text
      border: "rgba(0, 0, 0, 0.08)"
      border_hover: "rgba(0, 0, 0, 0.12)"
    dark:
      bg_base: "hsl(240, 10%, 3.5%)"       # Deep slate black
      bg_card: "hsl(240, 10%, 6%)"        # Dark slate surface
      bg_card_hover: "hsl(240, 10%, 8%)"  # Hover slate
      foreground: "hsl(0, 0%, 98%)"       # Near-white primary text
      foreground_muted: "hsl(240, 5%, 65%)" # Light grey secondary text
      border: "rgba(255, 255, 255, 0.08)"
      border_hover: "rgba(255, 255, 255, 0.12)"
    glass:
      bg_light: "rgba(255, 255, 255, 0.8)"
      bg_dark: "rgba(10, 10, 12, 0.8)"
      border_light: "rgba(0, 0, 0, 0.06)"
      border_dark: "rgba(255, 255, 255, 0.06)"
      shadow: "rgba(0, 0, 0, 0.03)"
  typography:
    font_sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
    font_display: "'Space Grotesk', sans-serif"
    font_mono: "'JetBrains Mono', monospace"
    sizes:
      xs: "0.75rem"
      sm: "0.85rem"
      base: "0.95rem"
      lg: "1.1rem"
      xl: "1.25rem"
      xxl: "1.5rem"
  spacing:
    container_padding: "20px"
    card_gap: "20px"
    border_radius_card: "14px"
    border_radius_inner: "8px"
  effects:
    blur: "16px"
    glow_radial: "radial-gradient(circle, rgba(79, 141, 252, 0.04) 0%, rgba(0, 0, 0, 0) 70%)"
---

# Google Stitch Design System & Redesign Specification

This file serves as the single source of truth for the styling constraints, visual tokens, and UI layout definitions of the **AutoHarness Studio** application. All AI coding subagents and developers must strictly follow the tokens and design principles declared herein.

## Visual Identity & Aesthetics

### 1. Unified Light & Dark Core Theme
The application layout is built with a premium glassmorphic approach. Rather than raw, unstyled backgrounds, it uses a soft base canvas overlayed with blurred glass cards.
- **Glassmorphism:** Outer containers and cards use high-contrast glass panels (`backdrop-filter: blur(16px)`), distinct borders, and soft shadows.
- **Micro-Animations:** Hovering over interactive panels should trigger a subtle transition (`transform: translateY(-1px)`, box-shadow transition, and border highlight).

### 2. Typography Hierarchy
- **Primary Body Text:** Standardized on `Inter` for ultra-high legibility in technical data grids, config YAML, and scorecards.
- **Header & Display Text:** Standardized on `Space Grotesk` to give key metrics, layout headers, and sidebar titles a clean, professional, and slightly tech-forward look.
- **Code & Logs:** Standardized on `JetBrains Mono` for terminal steps, trace paths, and raw configs.

### 3. Gating Color Scheme
- **Promoted / Passed:** Soft emerald green background with deep green text and border.
- **Rejected / Failed:** Soft rose red background with deep red text and border.
- **Pending / Stable:** Amber/Neutral gray background depending on the action state.
- **Brand Accents:** Cornflower blue gradients and accents represent active items, selected navigation tabs, and primary action buttons.

## CSS Implementation Directives

1. **Variables Integration:** All color references in components must utilize CSS custom properties defined in `src/app/globals.css` (e.g. `var(--primary)`, `hsl(var(--bg-base))`).
2. **Glass Panels:** Apply `.glass-panel` and `.glass-panel-interactive` classes instead of ad-hoc border and shadow utilities.
3. **No placeholders:** Always render actual data metrics and clean text descriptions.
