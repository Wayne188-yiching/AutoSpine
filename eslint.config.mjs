import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"],
  },
  {
    files: ["**/*.{js,mjs,ts}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
);
