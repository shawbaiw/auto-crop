/** @type {import("tailwindcss").Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Ice Mist status colors (color system v2 §4.3), so pages use states instead of Tailwind shades.
        status: {
          success: "var(--status-success-fg)",
          "success-bg": "var(--status-success-bg)",
          "success-border": "var(--status-success-border)",
          "success-icon": "var(--status-success-icon)",
          failed: "var(--status-failed-fg)",
          "failed-bg": "var(--status-failed-bg)",
          "failed-border": "var(--status-failed-border)",
          "failed-icon": "var(--status-failed-icon)",
          running: "var(--status-running-fg)",
          "running-bg": "var(--status-running-bg)",
          "running-border": "var(--status-running-border)",
          "running-icon": "var(--status-running-icon)",
          caution: "var(--status-caution-fg)",
          "caution-bg": "var(--status-caution-bg)",
          "caution-border": "var(--status-caution-border)",
          "caution-icon": "var(--status-caution-icon)",
          neutral: "var(--status-neutral-fg)",
          "neutral-bg": "var(--status-neutral-bg)",
          "neutral-border": "var(--status-neutral-border)",
          "neutral-icon": "var(--status-neutral-icon)",
        },
        "edge-strong": "var(--edge-strong)",
        selected: "var(--c-cool)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "Geist Variable",
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        workbench: "var(--shadow-workbench)",
      },
      keyframes: {
        "progress-indeterminate": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(250%)" },
        },
      },
      animation: {
        "progress-indeterminate": "progress-indeterminate 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
