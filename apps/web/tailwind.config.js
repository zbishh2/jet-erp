/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Linear-style semantic colors using CSS variables
        background: 'var(--color-bg)',
        'background-secondary': 'var(--color-bg-secondary)',
        'background-tertiary': 'var(--color-bg-tertiary)',
        'background-hover': 'var(--color-bg-hover)',
        'background-selected': 'var(--color-bg-selected)',
        foreground: 'var(--color-text)',
        'foreground-secondary': 'var(--color-text-secondary)',
        'foreground-tertiary': 'var(--color-text-tertiary)',
        border: 'var(--color-border)',
        'border-secondary': 'var(--color-border-secondary)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
}
