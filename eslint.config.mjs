import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Copied out of node_modules by postinstall, not written here: linting
    // pdf.js's minified worker produced 1,448 warnings about somebody else's
    // code and buried the eight that were ours.
    "public/pdfjs/**",
  ]),
  {
    // The files in scripts/ are Node scripts and CommonJS on purpose: start.js
    // runs before anything else and loads Next's server, which is CJS.
    files: ["scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // The suites are Node scripts run with tsx, not part of the bundle.
    files: ["scripts/**/*.mjs"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
]);

export default eslintConfig;
