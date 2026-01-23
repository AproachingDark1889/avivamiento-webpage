import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
import { createVuetify, type ThemeDefinition } from 'vuetify'

const genesisTheme: ThemeDefinition = {
  dark: false,
  colors: {
    primary: '#0D1B2A', // Deep Blue "Aviva"
    secondary: '#FFCA28', // Amber/Gold
    accent: '#82B1FF',
    error: '#FF5252',
    info: '#2196F3',
    success: '#4CAF50',
    warning: '#FB8C00',
    surface: '#F5F7FA', // Light Gray
    background: '#FFFFFF',
  },
}

export default defineNuxtPlugin((app) => {
  const vuetify = createVuetify({
    ssr: {
      clientWidth: 100,
      clientHeight: 100,
    },
    theme: {
      defaultTheme: 'genesisTheme',
      themes: {
        genesisTheme,
      },
    },
    defaults: {
      global: {
        ripple: true,
      },
      VCard: {
        rounded: 'lg',
        elevation: 2,
      },
      VBtn: {
        rounded: 'lg',
        height: 44,
        style: 'text-transform: none; font-weight: 700; letter-spacing: 0.5px;',
      },
      VTextField: {
        variant: 'outlined',
        density: 'comfortable',
        color: 'primary',
      },
      VSelect: {
        variant: 'outlined',
        density: 'comfortable',
        color: 'primary',
      },
      VAlert: {
        rounded: 'lg',
      },
    },
  })
  app.vueApp.use(vuetify)
})

