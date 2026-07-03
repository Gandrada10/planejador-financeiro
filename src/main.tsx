import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// PWA: registra o service worker (offline + instalável). Silencioso em falha.
// Atualização automática: quando um deploy novo troca o SW (skipWaiting +
// clients.claim), o evento controllerchange dispara e recarregamos a página UMA
// vez para pegar os assets novos — assim o deploy chega ao Guilherme sem ele
// precisar fechar todas as abas nem limpar cache na mão.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Só recarrega em ATUALIZAÇÃO (já havia um SW controlando). Na primeiríssima
    // instalação o clients.claim também emite controllerchange, mas aí a página
    // já está na versão nova — recarregar seria um flash à toa.
    const hadController = !!navigator.serviceWorker.controller
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing) return
      refreshing = true
      window.location.reload()
    })

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Procura versão nova ao abrir e sempre que a aba volta ao foco (PWA
        // instalado costuma ficar aberto por dias sem um reload "natural").
        reg.update().catch(() => {})
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {})
        })
      })
      .catch(() => {
        /* sem SW: app segue funcionando normalmente */
      })
  })
}
