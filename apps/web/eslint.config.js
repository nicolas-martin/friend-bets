import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

const compat = new FlatCompat();

export default [
	js.configs.recommended,
	...compat.extends('expo'),
	{
		files: ['**/*.{ts,tsx,js,jsx}'],
		plugins: {
			'@typescript-eslint': tsPlugin,
			'react': reactPlugin,
			'react-hooks': reactHooksPlugin,
		},
		languageOptions: {
			parser: tsParser,
			parserOptions: {
				ecmaVersion: 2020,
				sourceType: 'module',
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
		settings: {
			react: {
				version: 'detect',
			},
		},
		rules: {
			// TypeScript rules
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_'
			}],
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/prefer-const': 'error',
			'@typescript-eslint/no-non-null-assertion': 'warn',

			// React rules
			'react/prop-types': 'off',
			'react/react-in-jsx-scope': 'off',
			'react/jsx-uses-react': 'off',
			'react/jsx-uses-vars': 'error',
			'react/jsx-key': 'error',
			'react/no-unescaped-entities': 'warn',

			// React Hooks rules
			'react-hooks/rules-of-hooks': 'error',
			'react-hooks/exhaustive-deps': 'warn',

			// General rules
			'no-console': ['warn', { allow: ['warn', 'error'] }],
			'no-debugger': 'error',
			'no-alert': 'error',
			'prefer-const': 'error',
			'no-var': 'error',
			'object-shorthand': 'error',
			'prefer-template': 'error',
		},
	},
	{
		files: ['**/*.{js,jsx}'],
		rules: {
			'@typescript-eslint/no-var-requires': 'off',
		},
	},
	{
		ignores: [
			'node_modules/**',
			'dist/**',
			'.expo/**',
			'*.config.js',
			'*.config.ts',
		],
	},
];
