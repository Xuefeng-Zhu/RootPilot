import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        sidebar: {
          bg: '#1a1a2e',
          hover: '#16213e',
          active: '#0f3460',
          text: '#e0e0e0',
          muted: '#8892a4',
        },
        surface: {
          DEFAULT: '#0f0f1a',
          card: '#1a1a2e',
          border: '#2a2a3e',
        },
      },
    },
  },
  plugins: [],
};

export default config;
