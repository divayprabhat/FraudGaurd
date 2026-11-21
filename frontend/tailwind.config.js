const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'] },
      colors: { bg: c('bg'), surface: c('surface'), raised: c('raised'), line: c('line'), fg: c('fg'), muted: c('muted'),
                accent: c('accent'), ok: c('ok'), warn: c('warn'), bad: c('bad') },
      boxShadow: { card: 'var(--shadow)' },
      borderRadius: { DEFAULT: '8px', lg: '10px' },
    },
  },
  plugins: [],
};
