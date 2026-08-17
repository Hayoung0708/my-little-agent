/**
 * Conventional Commits 규칙을 강제한다.
 * 예) feat: 공유 메모리 추가 / fix: 툴 루프 무한 반복 수정 / docs: README 갱신
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 이 저장소는 커밋 제목을 한국어로 쓴다. 한국어에는 대소문자가 없어서
    // subject-case 규칙이 "Chrome", "README" 같은 고유명사만 보고 오탐한다.
    'subject-case': [0],
  },
}
