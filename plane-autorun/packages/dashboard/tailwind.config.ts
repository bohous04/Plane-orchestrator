import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["ui-monospace", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  darkMode: "class",
  plugins: [],
};

export default config;
