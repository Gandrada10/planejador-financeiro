import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Injeta um BUILD_ID único no service worker. Muda a cada build, então o
// byte-content do /sw.js muda → o navegador detecta um SW novo e o ciclo de
// atualização (install → skipWaiting → activate → clients.claim → reload no
// cliente) dispara sozinho. Sem isso, o /sw.js estático nunca mudava e o SW
// instalado no celular servia a versão antiga até todas as abas fecharem.
function swBuildId(): Plugin {
  const buildId = Date.now().toString(36)
  const marker = '__BUILD_ID__'
  return {
    name: 'sw-build-id',
    apply: 'build',
    closeBundle() {
      const out = resolve(__dirname, 'dist/sw.js')
      if (!existsSync(out)) return
      const src = readFileSync(out, 'utf8')
      writeFileSync(out, src.replace(new RegExp(marker, 'g'), buildId))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), swBuildId()],
})
