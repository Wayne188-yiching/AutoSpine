import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    // Generated private diagnostic/browser snippets are not production modules.
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts", "docs/local-reviews/**"],
  },
  {
    files: ["**/*.{js,mjs,ts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
);
