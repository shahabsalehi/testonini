# CBT Exam Simulator UI Manifest

A minimal, generic UI style manifest for a personal web-based computer-based exam simulator. No external assets, images, logos, or trademarks. Pure vanilla CSS tokens and class contracts.

## 1. CSS Custom Properties (Design Tokens)

```css
:root {
  /* Color Palette: Cool Gray */
  --gray-50: #f8fafc;
  --gray-100: #f1f5f9;
  --gray-200: #e2e8f0;
  --gray-300: #cbd5e1;
  --gray-400: #94a3b8;
  --gray-500: #64748b;
  --gray-600: #475569;
  --gray-700: #334155;
  --gray-800: #1e293b;
  --gray-900: #0f172a;

  /* Accent Color (e.g., Blue) */
  --accent-base: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-subtle: #dbeafe;

  /* Semantic Colors */
  --color-correct: #16a34a;   /* Green */
  --color-correct-bg: #dcfce7;
  --color-incorrect: #dc2626; /* Red */
  --color-incorrect-bg: #fee2e2;
  --color-flagged: #eab308;   /* Yellow/Gold */
  --color-flagged-bg: #fef9c3;

  /* Typography */
  --font-sans: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --text-base: 1rem;       /* 16px */
  --text-sm: 0.875rem;     /* 14px */
  --text-lg: 1.125rem;     /* 18px */
  --text-xl: 1.25rem;      /* 20px */

  /* Spacing Scale */
  --space-1: 0.25rem; /* 4px */
  --space-2: 0.5rem;  /* 8px */
  --space-3: 0.75rem; /* 12px */
  --space-4: 1rem;    /* 16px */
  --space-6: 1.5rem;  /* 24px */
  --space-8: 2rem;    /* 32px */
  --space-12: 3rem;   /* 48px */

  /* Borders & Radii */
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 6px;
  --border-light: 1px solid var(--gray-200);
  --border-dark: 1px solid var(--gray-300);

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --shadow-focus: 0 0 0 3px rgba(37, 99, 235, 0.5); /* Accent focus ring */
}
```

## 2. Class Contracts (UI Components)

### Layout & Shell
- `.exam-shell`: The main application wrapper. Typically `100vh`. Applies `--gray-50` background.
- `.split-pane`: A layout container dividing the screen.
  - `.pane-pdf`: The left pane (`55%` width on desktop) for reading material/PDFs. Border-right: `--border-dark`.
  - `.pane-questions`: The right pane (`45%` width on desktop) for interaction.

### Header & Navigation
- `.timer-chip`: A small pill/chip displaying the remaining time. Monospace font, high contrast.
- `.question-palette`: A grid of buttons representing all questions for quick navigation.
  - `.unanswered`: Default state, gray border.
  - `.answered`: Solid state, usually filled with `--gray-200` or subtle color.
  - `.flagged`: Indicates question marked for review. Uses `--color-flagged` (e.g., background or border).
  - `.current`: Highlights the currently active question. Thicker border or shadow using `--accent-base`.

### Questions & Interactions
- `.question-card`: Container for a single question item. Padded with `--space-6`, background white, `--shadow-sm`.
- `.option-row`: A clickable row for multiple-choice options. Hover state applies `--gray-50`. Includes standard spacing.
- `.text-input`: Standard text input field. Padding, border radius `--radius-md`.
- `.writing-area`: Textarea container for essays.
  - `.word-count`: Small text aligned right below the textarea, tracking word limits.

### Review & Results
- `.review-summary`: A list view showing all questions, their states (answered/unanswered/flagged), and links to jump to them.
- `.results-panel`: End-of-exam view displaying score and analytics. Uses semantic correct/incorrect colors heavily.

### Buttons
- `.btn`: Base button class. Padding `--space-2` `--space-4`, cursor pointer, rounded `--radius-md`.
- `.btn-primary`: Primary action (e.g., "Next", "Submit"). Background `--accent-base`, text white.
- `.btn-ghost`: Secondary action (e.g., "Clear", "Flag"). Transparent background, border `--border-light`, hover background `--gray-100`.

## 3. Constraints & Behaviors

- **Viewport Size:** The layout requires a minimum width of `1024px` (`min-width: 1024px`).
- **Animations/Transitions:** Strictly limited to `150ms` (e.g., `transition: all 150ms ease;`). No long, distracting animations to avoid cognitive load.
- **Iconography:** No external icon fonts or SVGs. Use Unicode glyphs only (e.g., `⚑` for flagged, `✓` for correct, `✗` for incorrect, `◀`, `▶` for navigation).
- **Accessibility:**
  - **Focus Indicators:** Every interactive element must have a clear `:focus-visible` state using `--shadow-focus`. Outline must not be `none` unless replaced by a box-shadow.
  - **Contrast:** All text colors must meet WCAG high contrast standards against their backgrounds (e.g., `--gray-900` on `--gray-50`).
