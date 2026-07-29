import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/.expo/**"] },
  {
    ...js.configs.recommended,
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
);
