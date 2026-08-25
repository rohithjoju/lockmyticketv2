import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';

/**
 * Tailwind v4 is CSS-first; this file is loaded by `@config` in globals.css and
 * carries only what still belongs in JS — the forms plugin and the content
 * globs. The design tokens live in globals.css under `@theme`.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  plugins: [forms({ strategy: 'class' })],
} satisfies Config;
