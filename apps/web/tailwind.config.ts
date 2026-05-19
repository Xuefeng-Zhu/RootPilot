import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          bg: '#060b12',
          hover: '#0e1a28',
          active: '#10263a',
          text: '#e5edf7',
          muted: '#7d8da3',
        },
        surface: {
          DEFAULT: '#070b12',
          card: '#0d1520',
          raised: '#111c2a',
          border: '#1d2a3a',
          subtle: '#0a111b',
        },
        accent: {
          teal: '#2dd4bf',
          cyan: '#22d3ee',
          blue: '#60a5fa',
          purple: '#a78bfa',
          amber: '#f59e0b',
          red: '#f87171',
          green: '#34d399',
          gray: '#94a3b8',
        },
      },
      boxShadow: {
        panel: '0 16px 40px rgba(0, 0, 0, 0.28)',
        glow: '0 0 0 1px rgba(45, 212, 191, 0.12), 0 18px 52px rgba(8, 145, 178, 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
