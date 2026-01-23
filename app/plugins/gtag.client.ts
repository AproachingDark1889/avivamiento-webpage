// Google Tag Manager Plugin
// Reemplaza 'GTM-XXXXXXX' con tu ID real de Google Tag Manager
// Para obtenerlo: https://tagmanager.google.com → Container ID

export default defineNuxtPlugin(() => {
  const GTM_ID = 'GTM-NP63RVGW'

  if (typeof window !== 'undefined') {
    // Inicializar dataLayer
    window.dataLayer = window.dataLayer || []
    
    // Función helper para push de eventos
    window.dataLayer.push({
      'gtm.start': new Date().getTime(),
      event: 'gtm.js'
    })

    // Cargar GTM script
    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`
    document.head.appendChild(script)

    // Función global para rastrear eventos personalizados
    window.trackEvent = (eventName, eventParams = {}) => {
      window.dataLayer.push({
        event: eventName,
        ...eventParams
      })
    }
  }
})
