/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: 'var(--navy-950)',
          900: 'var(--navy-900)',
          800: 'var(--navy-800)',
          700: 'var(--navy-700)',
          600: 'var(--navy-600)',
          100: 'var(--navy-100)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          soft: 'var(--accent-soft)',
          dark: 'var(--accent-dark)',
          wash: 'var(--accent-wash)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
          subtle: 'var(--ink-subtle)',
        },
        line: {
          DEFAULT: 'var(--line)',
          soft: 'var(--line-soft)',
        },
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        success: { DEFAULT: 'var(--success)', wash: 'var(--success-wash)' },
        danger: { DEFAULT: 'var(--danger)', wash: 'var(--danger-wash)' },
        warning: { DEFAULT: 'var(--warning)', wash: 'var(--warning-wash)' },
        neutral: { DEFAULT: 'var(--neutral)', wash: 'var(--neutral-wash)' },
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
