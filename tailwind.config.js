/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg:      'var(--bg)',
        'bg-1':  'var(--bg-1)',
        'bg-2':  'var(--bg-2)',
        'bg-3':  'var(--bg-3)',
        surface: 'var(--surface)',
        raised:  'var(--surface-raised)',
        ink:     'var(--ink)',
        'ink-2': 'var(--ink-2)',
        muted:   'var(--muted)',
        faint:   'var(--subtle)',
        accent:  'var(--accent)',
        line:    'var(--line)',
        'line-2':'var(--line-2)',
        success: 'var(--success)',
        danger:  'var(--danger)',
      },
      fontFamily: {
        sans:  ['Geist', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        mono:  ['"Geist Mono"', '"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        sm:      '6px',
        card:    '16px',
        panel:   '28px',
        pill:    '999px',
      },
      boxShadow: {
        modal:  '0 24px 80px rgba(0,0,0,0.55)',
        accent: '0 10px 40px rgba(27,146,255,0.28)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      transitionDuration: {
        hover:    '120ms',
        state:    '200ms',
        entrance: '550ms',
      },
      keyframes: {
        'slide-up': {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'typing-dot': {
          '0%, 60%, 100%': { transform: 'translateY(0)', opacity: '0.45' },
          '30%':           { transform: 'translateY(-3px)', opacity: '1' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.6' },
          '50%':      { opacity: '1' },
        },
        'check-draw': {
          '0%':   { 'stroke-dashoffset': '30' },
          '100%': { 'stroke-dashoffset': '0' },
        },
        'scale-in': {
          '0%':   { opacity: '0', transform: 'scale(0.94)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        marquee: {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-8px)' },
        },
      },
      animation: {
        'slide-up':   'slide-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in':    'fade-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both',
        'typing-dot': 'typing-dot 1.2s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 7s ease-in-out infinite',
        'check-draw': 'check-draw 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'scale-in':   'scale-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        marquee:      'marquee 48s linear infinite',
        float:        'float 7s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
