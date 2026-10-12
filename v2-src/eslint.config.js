import tseslint from 'typescript-eslint';
import typegpu from 'eslint-plugin-typegpu';

export default tseslint.config(
  { ignores: ['node_modules'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    ...typegpu.configs.recommended,
  },
);
