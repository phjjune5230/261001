import next from 'eslint-config-next'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

// eslint-config-next v16은 flat config 배열을 그대로 export 한다
// (팩토리 함수가 아니므로 호출하면 안 된다)
const eslintConfig = [
  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: ['.next/**', 'node_modules/**', 'out/**', 'next-env.d.ts'],
  },
]

export default eslintConfig
