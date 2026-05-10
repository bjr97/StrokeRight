/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0D1117',
        card: '#161B22',
        border: '#21262D',
        accent: '#3FB950',
        muted: '#8B949E',
        text: '#E6EDF3',
        danger: '#F85149',
        warn: '#D29922',
        tier: {
          1: '#58A6FF', // dark blue
          2: '#D29922', // orange
          3: '#3FB950', // dark green
          4: '#79C0FF', // light blue
          5: '#7DC991', // light green
          6: '#D2D250', // yellow
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
