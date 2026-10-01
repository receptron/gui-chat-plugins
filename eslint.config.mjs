import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  { ignores: ["**/dist/**", "**/node_modules/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.es2022, ...globals.browser, ...globals.node },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Moved from MulmoClaude (whose config does not enable this rule) with its
    // non-null assertions intact: 193 sites in the parser, evaluator, CSG and
    // tests. Rewriting them belongs in a change of its own, not in the move.
    // Delete this entry once packages/shapescript has none left.
    files: ["packages/shapescript/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  eslintConfigPrettier,
];
