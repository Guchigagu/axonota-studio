export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--ax-bg)",
        fg: "var(--ax-fg)",
        card: "var(--ax-card)",
        muted: "var(--ax-muted)",
        mutedfg: "var(--ax-muted-fg)",
        border: "var(--ax-border)",
        surface: "var(--ax-surface)",
        surface2: "var(--ax-surface-2)",
        ink2: "var(--ax-ink-2)",
        ink3: "var(--ax-ink-3)",
        accent: "var(--ax-accent)",
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
      },
      fontFamily: {
        sans: ["var(--ax-font-sans)"],
        mono: ["var(--ax-font-mono)"],
      },
    },
  },
  plugins: [],
};
