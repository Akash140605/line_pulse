// Line Pulse theme — standard navy blue #0B3A74 / #0B2545 (primary, sidebar, live line) · red (accent) · sky (data)
//   steel page #EEF1F5 · white panels with hairline borders · IBM Plex Sans + IBM Plex Mono (numbers)
//   All of it can be changed by the admin in Setup → Theme (CSS variables, see src/utils/themeEngine.js).
//   Sharper: tighter corners, light shadows, weights capped at 700 (Plex has no 800/900).
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontWeight: { medium: '500', semibold: '600', bold: '700', extrabold: '700', black: '700' },   // heavier than before: easier to read on shop-floor screens
      // colour families come from CSS variables set by the theme (utils/themeEngine.js, Setup → Theme); defaults in index.css
      colors: {
        dixon: { red: 'rgb(var(--red-600) / <alpha-value>)', navy: 'rgb(var(--navy) / <alpha-value>)', ink: '#0F1B2D', steel: 'rgb(var(--page) / <alpha-value>)', sidebar: 'rgb(var(--sidebar) / <alpha-value>)' },
        blue: { 50: 'rgb(var(--blue-50) / <alpha-value>)', 100: 'rgb(var(--blue-100) / <alpha-value>)', 200: 'rgb(var(--blue-200) / <alpha-value>)', 300: 'rgb(var(--blue-300) / <alpha-value>)', 400: 'rgb(var(--blue-400) / <alpha-value>)', 500: 'rgb(var(--blue-500) / <alpha-value>)', 600: 'rgb(var(--blue-600) / <alpha-value>)', 700: 'rgb(var(--blue-700) / <alpha-value>)', 800: 'rgb(var(--blue-800) / <alpha-value>)', 900: 'rgb(var(--blue-900) / <alpha-value>)', 950: 'rgb(var(--blue-950) / <alpha-value>)' },
        sky: { 50: 'rgb(var(--sky-50) / <alpha-value>)', 100: 'rgb(var(--sky-100) / <alpha-value>)', 200: 'rgb(var(--sky-200) / <alpha-value>)', 300: 'rgb(var(--sky-300) / <alpha-value>)', 400: 'rgb(var(--sky-400) / <alpha-value>)', 500: 'rgb(var(--sky-500) / <alpha-value>)', 600: 'rgb(var(--sky-600) / <alpha-value>)', 700: 'rgb(var(--sky-700) / <alpha-value>)', 800: 'rgb(var(--sky-800) / <alpha-value>)', 900: 'rgb(var(--sky-900) / <alpha-value>)', 950: 'rgb(var(--sky-950) / <alpha-value>)' },
        red: { 50: 'rgb(var(--red-50) / <alpha-value>)', 100: 'rgb(var(--red-100) / <alpha-value>)', 200: 'rgb(var(--red-200) / <alpha-value>)', 300: 'rgb(var(--red-300) / <alpha-value>)', 400: 'rgb(var(--red-400) / <alpha-value>)', 500: 'rgb(var(--red-500) / <alpha-value>)', 600: 'rgb(var(--red-600) / <alpha-value>)', 700: 'rgb(var(--red-700) / <alpha-value>)', 800: 'rgb(var(--red-800) / <alpha-value>)', 900: 'rgb(var(--red-900) / <alpha-value>)', 950: 'rgb(var(--red-950) / <alpha-value>)' },
      },
      // text-fs-N = N px × the text size chosen in Setup → Theme (10–12 are read a little bigger, for shop-floor screens)
      fontSize: Object.fromEntries([10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30, 34, 40, 42, 50]
        .map((n) => [`fs-${n}`, `calc(var(--t-${n}, ${({ 10: 11, 11: 11.5, 12: 12.5 })[n] || n}px) * var(--fs, 1))`])
        // the text sizes of the Dixon MES (Production Management System): tick 11 · label 12 · body 13 · sub 14 · title 15 · KPI 20 · hero 30
        .concat(Object.entries({ tick: 12, label: 14, body: 15, sub: 16, title: 19, kpi: 24, hero: 34 }).map(([k, n]) => [`mes-${k}`, `calc(${n}px * var(--fs, 1))`]))),
      borderRadius: { md: '5px', lg: '6px', xl: '8px', '2xl': '10px' },
      boxShadow: {
        sm: '0 1px 2px rgba(15, 27, 45, 0.06)',
        DEFAULT: '0 1px 2px rgba(15, 27, 45, 0.06), 0 1px 3px rgba(15, 27, 45, 0.06)',
        md: '0 1px 2px rgba(15, 27, 45, 0.05), 0 2px 6px rgba(15, 27, 45, 0.06)',
        lg: '0 2px 4px rgba(15, 27, 45, 0.06), 0 8px 20px rgba(15, 27, 45, 0.08)',
        xl: '0 4px 8px rgba(15, 27, 45, 0.08), 0 14px 32px rgba(15, 27, 45, 0.12)',
      },
    },
  },
  plugins: [],
};
