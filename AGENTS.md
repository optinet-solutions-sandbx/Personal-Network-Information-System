<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Troubleshooting

**"An unexpected Turbopack error occurred" / `FATAL: ... panic log` on `next dev`** (panic log says `Failed to write app endpoint`, `evaluate_webpack_loader failed`, `connection forcibly closed (os error 10054)`): the Node PostCSS worker Turbopack spawns for `@tailwindcss/postcss` died mid-write and corrupted `.next`, so every load 500s until the cache is cleared. The CSS/config is fine — don't edit `globals.css` or `postcss.config.mjs`. Fix: `npm run dev:clean` (clears `.next`, then starts dev). Standalone clear: `npm run clean`.
