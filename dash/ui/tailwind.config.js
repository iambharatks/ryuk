/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0B0B0E",
        surface: "#141419",
        raised: "#1B1B22",
        hairline: "#24242C",
        hover: "#363642",
        ink: "#F4F4F6",
        slate: { DEFAULT: "#8E8E9A", dim: "#5E5E6A" },
        apple: { DEFAULT: "#C84B31", dim: "#7A3020" },
      },
      fontFamily: {
        serif: ['"Mansalva"', "Georgia", "serif"],
        sans: ['"Mansalva"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        frak: ['"Jacquard 24"', '"Grenze Gotisch"', "serif"],
        gothic: ['"Grenze Gotisch"', "serif"],
        tech: ['"Share Tech Mono"', '"JetBrains Mono"', "monospace"],
        hand: ['"Mansalva"', '"Segoe Print"', "cursive"],
      },
      borderRadius: { bento: "20px" },
      keyframes: { pulseDot: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } } },
      animation: { pulseDot: "pulseDot 2.4s ease-in-out infinite" },
    },
  },
  plugins: [],
};
