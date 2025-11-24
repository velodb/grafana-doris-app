/** @type {import('tailwindcss').Config} */
import baseConfig from 'tailwind-config/preset'; // 👈 来自 shadcn preset 包

module.exports = {
  presets: [baseConfig],
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './src/pages/*.{js,ts,jsx,tsx}',
    './src/components//**/*.{js,ts,jsx,tsx}',
    './src/components//**/**/*.{js,ts,jsx,tsx}',
  ], // 🔥 这是关键！

  theme: {
    container: {
      center: 'true',
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        b1: 'hsl(var(--b1))',
        b2: 'hsl(var(--b2))',
        b3: 'hsl(var(--b3))',
        b4: 'hsl(var(--b4))',
        b5: 'hsl(var(--b5))',
        b6: 'hsl(var(--b6))',
        b7: 'hsl(var(--b7))',
        b8: 'hsl(var(--b8))',
        n1: 'hsl(var(--n1))',
        n2: 'hsl(var(--n2))',
        n3: 'hsl(var(--n3))',
        n4: 'hsl(var(--n4))',
        n5: 'hsl(var(--n5))',
        n6: 'hsl(var(--n6))',
        n7: 'hsl(var(--n7))',
        n8: 'hsl(var(--n8))',
        n9: 'hsl(var(--n9))',
        g1: 'hsl(var(--g1))',
        g2: 'hsl(var(--g2))',
        g3: 'hsl(var(--g3))',
        g4: 'hsl(var(--g4))',
        g5: 'hsl(var(--g5))',
        g6: 'hsl(var(--g6))',
        o1: 'hsl(var(--o1))',
        o2: 'hsl(var(--o2))',
        o3: 'hsl(var(--o3))',
        o4: 'hsl(var(--o4))',
        o5: 'hsl(var(--o5))',
        o6: 'hsl(var(--o6))',
        r1: 'hsl(var(--r1))',
        r2: 'hsl(var(--r2))',
        r3: 'hsl(var(--r3))',
        r4: 'hsl(var(--r4))',
        r5: 'hsl(var(--r5))',
        r6: 'hsl(var(--r6))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        table: {
          'header-background': 'hsl(var(--table-header-background))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
        sidebar: {
          DEFAULT: 'transparent',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
        'status-processing': {
          from: {
            transform: 'scale(0.8)',
            opacity: '0.5',
          },
          to: {
            transform: 'scale(1.5)',
            opacity: '0',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        processing: 'status-processing 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
