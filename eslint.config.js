const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

module.exports = [
	{
		ignores: ["build/**", "node_modules/**"],
	},
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 2022,
				sourceType: "module",
				project: "./tsconfig.json",
			},
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
		},
		rules: {
			...tsPlugin.configs.recommended.rules,
			"indent": "off",
			"quotes": ["error", "double", { "avoidEscape": true, "allowTemplateLiterals": true }],
			"@typescript-eslint/no-parameter-properties": "off",
			"@typescript-eslint/no-use-before-define": ["error", {
				"functions": false,
				"typedefs": false,
				"classes": false,
			}],
			"@typescript-eslint/no-unused-vars": ["error", {
				"ignoreRestSiblings": true,
				"argsIgnorePattern": "^_",
			}],
			"@typescript-eslint/explicit-function-return-type": ["warn", {
				"allowExpressions": true,
				"allowTypedFunctionExpressions": true,
			}],
			"@typescript-eslint/no-object-literal-type-assertion": "off",
			"@typescript-eslint/no-non-null-assertion": "off",
			"no-var": "error",
			"prefer-const": "error",
			"no-trailing-spaces": "error",
		},
	},
	{
		files: ["src/**/*.test.ts"],
		rules: {
			"@typescript-eslint/explicit-function-return-type": "off",
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
];
