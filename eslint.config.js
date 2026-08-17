// @ts-check
import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  {
    // 빌드 산출물과, 타입 검사 프로젝트 밖에 있는 개발용 스크립트는 검사 대상이 아니다.
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'scripts/**',
      'example/**',
      '*.config.js',
    ],
  },
  ...tanstackConfig,
  {
    rules: {
      // 이 라이브러리는 Prompt API 타입을 느슨하게 다뤄야 해서 몇 가지를 완화한다.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
]
