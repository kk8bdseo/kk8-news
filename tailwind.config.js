/** KK8 Bangladesh — design tokens from CLAUDE.md §3 (live-site brand CI scrape).
 *  Colours are tokens, never hard-coded ad hoc. No webfont: KK8 uses the system stack. */
module.exports = {
  content: ['./*.html', './en/**/*.html', './pages/**/*.html', './partials/**/*.html'],
  theme: {
    extend: {
      colors: {
        'brand-blue':   '#0047FF', // primary CTA, links, theme-color
        'brand-navy':   '#001957', // dark surfaces, headings, body copy
        'brand-tint':   '#F1F5FF', // secondary surface, soft panels
        'brand-bright': '#1556FF', // highlight accent
        'brand-hair':   '#E2E8F4', // hairline borders
        'brand-slate':  '#54606E', // secondary body text
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        base: '5px',   // cards, panels
        btn:  '6px',   // primary button
        pill: '24px',  // secondary / pill button
        input: '0px',  // inputs are square
      },
      // Bengali script carries taller ascenders/descenders than Latin —
      // body leading is set looser than Tailwind's default for legibility.
      lineHeight: { bn: '1.85', 'bn-tight': '1.5' },
      maxWidth: { prose: '68ch' },
    },
  },
  plugins: [],
};
