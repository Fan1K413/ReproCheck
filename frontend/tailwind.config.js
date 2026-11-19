/** @type {import('tailwindcss').Config} */
const rgb = (name) => `rgb(var(--${name}-rgb) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: rgb('navy-950'),
          900: rgb('navy-900'),
          800: rgb('navy-800'),
          700: rgb('navy-700'),
          600: rgb('navy-600'),
          100: rgb('navy-100'),
        },
        accent: {
          DEFAULT: rgb('accent'),
          soft: rgb('accent-soft'),
          dark: rgb('accent-dark'),
          wash: rgb('accent-wash'),
        },
        ink: {
          DEFAULT: rgb('ink'),
          muted: rgb('ink-muted'),
          subtle: rgb('ink-subtle'),
        },
        line: {
          DEFAULT: rgb('line'),
          soft: rgb('line-soft'),
        },
        canvas: rgb('canvas'),
        surface: rgb('surface'),
        success: { DEFAULT: rgb('success'), wash: rgb('success-wash') },
        danger: { DEFAULT: rgb('danger'), wash: rgb('danger-wash') },
        warning: { DEFAULT: rgb('warning'), wash: rgb('warning-wash') },
        neutral: { DEFAULT: rgb('neutral'), wash: rgb('neutral-wash') },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        pop: 'var(--shadow-pop)',
      },
      borderRadius: {
        panel: 'var(--radius-panel)',
      },
    },
  },
  plugins: [],
}