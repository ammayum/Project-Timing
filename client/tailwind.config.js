/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bt: {
          purple: "#5514B4",
          "purple-lightest": "#CBB8E7",
          "purple-light": "#A988D9",
          "purple-mid": "#885AC9",
          "purple-dark": "#441090",
          "purple-darker": "#3B0E7E",
          "purple-deep": "#2A0A5A",
          white: "#FFFFFF",
          "grey-50": "#F5F5F5",
          "grey-200": "#D9D9D9",
          "grey-400": "#B3B3B3",
          "grey-600": "#737373",
          black: "#000000",
          "chart-blue-1": "#8475E5",
          "chart-blue-2": "#5740DA",
          "chart-blue-3": "#280071",
          "chart-red-1": "#E796A9",
          "chart-red-2": "#D52A4F",
          "chart-red-3": "#A60A3D",
        },
        ink: "#000000",
        mist: "#D9D9D9",
        flare: "#5514B4",
        aqua: "#5514B4",
        coral: "#441090",
      },
      fontFamily: {
        sans: ["'Segoe UI Variable'", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        panel: "0 18px 45px rgba(85, 20, 180, 0.12)",
      },
    },
  },
  plugins: [],
};
