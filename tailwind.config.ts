import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Aptos", "Segoe UI Variable", "Segoe UI", "sans-serif"],
        display: ["Georgia", "Times New Roman", "serif"],
      },
      borderRadius: {
        card: "1.35rem",
        "card-lg": "1.7rem",
        pill: "999px",
        input: "1.1rem",
      },
      boxShadow: {
        "panel-sm": "0 4px 12px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)",
        panel: "0 8px 24px rgba(15, 23, 42, 0.08), 0 2px 8px rgba(15, 23, 42, 0.04)",
        "panel-lg": "0 16px 40px rgba(15, 23, 42, 0.1), 0 4px 12px rgba(15, 23, 42, 0.05)",
        "panel-elevated": "0 24px 56px rgba(15, 23, 42, 0.14), 0 8px 20px rgba(15, 23, 42, 0.06), 0 0 0 1px rgba(255,255,255,0.04)",
      },
      colors: {
        ink: "#0f172a",
        mist: "#e2e8f0",
        signal: "#d97706",
        emerald: "#047857",
      },
      fontSize: {
        "display-md": ["2.5rem", { lineHeight: "1.08", letterSpacing: "-0.02em" }],
        "display-lg": ["3.65rem", { lineHeight: "1.02", letterSpacing: "-0.025em" }],
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
        bounce: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 420ms cubic-bezier(0.4, 0, 0.2, 1) both",
        "scale-in": "scale-in 350ms cubic-bezier(0.4, 0, 0.2, 1) both",
        shimmer: "shimmer 2s ease-in-out infinite",
      },
      backgroundImage: {
        "hero-mesh":
          "radial-gradient(circle at 20% 20%, rgba(217, 119, 6, 0.16), transparent 36%), radial-gradient(circle at 80% 0%, rgba(12, 74, 110, 0.16), transparent 32%), linear-gradient(135deg, rgba(255,255,255,0.94), rgba(248,250,252,0.9))",
        "hero-mesh-dark":
          "radial-gradient(circle at 20% 20%, rgba(251, 191, 36, 0.16), transparent 34%), radial-gradient(circle at 80% 0%, rgba(56, 189, 248, 0.14), transparent 30%), linear-gradient(135deg, rgba(15,23,42,0.96), rgba(30,41,59,0.92))",
      },
    },
  },
  plugins: [],
};

export default config;
