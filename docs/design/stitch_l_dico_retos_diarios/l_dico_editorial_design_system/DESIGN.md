---
name: Lúdico Editorial Design System
colors:
  surface: '#fdf9f0'
  surface-dim: '#dddad1'
  surface-bright: '#fdf9f0'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f7f3ea'
  surface-container: '#f1eee5'
  surface-container-high: '#ece8df'
  surface-container-highest: '#e6e2d9'
  on-surface: '#1c1c16'
  on-surface-variant: '#45464d'
  inverse-surface: '#31302b'
  inverse-on-surface: '#f4f0e7'
  outline: '#75777e'
  outline-variant: '#c5c6ce'
  surface-tint: '#525e7a'
  primary: '#020d25'
  on-primary: '#ffffff'
  primary-container: '#17233c'
  on-primary-container: '#7f8aa9'
  inverse-primary: '#bac6e7'
  secondary: '#aa370b'
  on-secondary: '#ffffff'
  secondary-container: '#ff7346'
  on-secondary-container: '#661a00'
  tertiary: '#00120a'
  on-tertiary: '#ffffff'
  tertiary-container: '#002a1b'
  on-tertiary-container: '#2e9c74'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#bac6e7'
  on-primary-fixed: '#0f1b34'
  on-primary-fixed-variant: '#3b4661'
  secondary-fixed: '#ffdbd0'
  secondary-fixed-dim: '#ffb59e'
  on-secondary-fixed: '#3a0b00'
  on-secondary-fixed-variant: '#842500'
  tertiary-fixed: '#8ef7c9'
  tertiary-fixed-dim: '#72daae'
  on-tertiary-fixed: '#002115'
  on-tertiary-fixed-variant: '#005139'
  background: '#fdf9f0'
  on-background: '#1c1c16'
  surface-variant: '#e6e2d9'
typography:
  display-lg:
    fontFamily: Source Serif 4
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Source Serif 4
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Source Serif 4
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-bold:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '700'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  container-max: 1200px
  gutter: 24px
---

## Brand & Style
The design system is built on a "Modern Editorial" philosophy, prioritizing deep focus and mental clarity for daily cognitive exercises. The aesthetic bridges the gap between a high-end literary journal and a responsive digital gaming experience. It avoids typical "gamification" tropes like neon glows or juvenile illustrations in favor of a tactile, paper-like interface that feels premium and intentional.

The style is **Minimalist with Tactile accents**, utilizing a high-contrast ink-on-paper feel. The goal is to evoke the calm satisfaction of a morning crossword puzzle found in a prestigious broadsheet, modernized for high-performance interaction. Motion should be purposeful and snappy, emphasizing physical metaphors like sliding paper or ink soaking into a page.

## Colors
The palette is rooted in institutional reliability and energetic focus.
- **Ink Blue (#17233C):** Used for primary text, deep borders, and high-emphasis interface elements. It provides the "ink" contrast against the light surfaces.
- **Warm Paper (#F7F3EA):** The default background color. It reduces eye strain during long concentration periods compared to pure white.
- **Pure White (#FFFFFF):** Reserved for elevated containers, active input fields, or cards that need to pop against the paper background.
- **Energy Orange (#F26A3D):** The action color. Used for primary buttons, highlights, and critical "aha!" moments.
- **Success Green & Hint Yellow:** Functional colors for feedback loops, maintaining the same saturated, "printed" quality as the rest of the palette.

## Typography
This design system employs a sophisticated pairing of **Source Serif 4** for editorial weight and **Hanken Grotesk** for functional clarity.

- **Headlines:** Use the Serif for all titles, headers, and puzzle names. It provides the authoritative, "classic" feel of a published pasatiempo.
- **Body & UI:** Use the Sans-serif for all instructional text, game labels, and system feedback. It is clean, modern, and highly legible at small sizes.
- **Tracking:** Labels and small UI elements should utilize slightly increased letter-spacing to maintain a professional, architectural feel.

## Layout & Spacing
The layout follows a strict **8-point grid** system to ensure mathematical harmony.
- **Grid Model:** Use a 12-column fixed grid for desktop (centered) and a fluid 4-column grid for mobile.
- **Rhythm:** Spacing between related puzzle elements (like cells in a grid) should use `xs` or `sm`. Spacing between distinct content sections should use `xl`.
- **Negative Space:** Embrace generous margins (`lg` or `xl`) to create an "open book" feel, preventing the interface from feeling cluttered or overwhelming.

## Elevation & Depth
Elevation in this design system is achieved through **Tonal Layers and Crisp Outlines** rather than heavy shadows.
- **Level 0 (Base):** The Warm Paper surface.
- **Level 1 (Cards/Tiles):** Pure White surfaces with a subtle 1px border in Ink Blue at 10% opacity.
- **Level 2 (Interactive/Floating):** Use a "Tight Shadow"—a very low-blur, high-opacity offset shadow (e.g., 4px 4px 0px) in a translucent Ink Blue to mimic the look of stacked cardstock.
- **Depth:** Avoid blurs. Instead, use sharp 1px or 2px dividers in Ink Blue (low opacity) to separate content sections.

## Shapes
The shape language is structured yet friendly, utilizing specific corner radii to denote different content types:
- **Small (8px):** Used for input fields, puzzle cells (Sudoku, Crossword), and small utility buttons.
- **Medium (12px):** The standard for primary buttons, cards, and selection states.
- **Large (20px):** Used for large modal containers and prominent "Hero" cards on the dashboard.
- **Consistency:** Elements that live inside one another should have nested radii (e.g., an 8px radius button inside a 12px radius card) to maintain visual alignment.

## Components
- **Buttons:** Primary buttons use Energy Orange with White text, Bold weight. Use the 2px "Tight Shadow" on hover to create a tactile "pressable" feel. Secondary buttons use Ink Blue outlines.
- **Puzzle Tiles:** Square or slightly rounded (8px) white boxes. Active states should use a thick 2px Ink Blue border. Success states use a Success Green background at 10% opacity with a Green border.
- **Chips:** Small, pill-shaped labels for categories (e.g., "Lógica", "Palabras") using the Warm Paper background and Ink Blue text.
- **Lists:** Clean, horizontal rows separated by 1px dividers. Use Hanken Grotesk for list items with high contrast for the title and lower contrast for metadata.
- **Input Fields:** Minimalist style. No background, just a bottom border in Ink Blue (20% opacity) that turns into a 2px Energy Orange border on focus.
- **Progress Bars:** Thin, 4px height bars. The track is the Paper color, and the fill is Energy Orange or Success Green.
