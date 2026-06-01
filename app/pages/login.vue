<template>
  <ClientOnly>
    <v-app>
      <v-main class="login-container pa-0">
        <v-row no-gutters class="fill-height">
          <!-- Left Panel: Cinematic Image -->
          <v-col cols="12" md="6" lg="6" class="d-none d-md-flex flex-column position-relative justify-center align-center pa-0" style="background-color: #050505;">
            
            <!-- Image spans the entire horizontal block, no cropping -->
            <img
              src="/images/avivacheck.png"
              alt="Aviva Check Background"
              style="width: 100%; max-height: 100vh; object-fit: contain; z-index: 2;"
            />

            <!-- Text Box at Bottom -->
            <div class="position-absolute w-100 d-flex flex-column justify-end pa-10" style="bottom: 0; left: 0; z-index: 3;">
              <div class="glass-text-box mb-8">
                <h1 class="text-h3 font-weight-bold text-white mb-2">
                  AVIVA CHECK
                </h1>
                <p class="text-h6 text-white font-weight-light" style="opacity: 0.9">
                  Gestión Integral de departamentos y control financiero
                </p>
              </div>
            </div>
            
            <!-- Gradient Overlay (Background) -->
            <div class="image-overlay position-absolute" style="top: 0; left: 0; width: 100%; height: 100%; z-index: 1;"></div>
          </v-col>

          <!-- Right Panel: Glass Form -->
          <v-col cols="12" md="6" lg="6" class="d-flex align-center justify-center bg-dark-gradient position-relative">
            <!-- Background Elements -->
            <div class="bg-orb orb-1"></div>
            <div class="bg-orb orb-2"></div>

            <v-card width="100%" max-width="480" class="glass-card ma-4 pa-8" elevation="24">
              <!-- Header -->
              <div class="text-center mb-8">
                <div class="icon-container mb-6 mx-auto">
                    <v-icon icon="mdi-shield-check" size="48" color="white" class="shield-icon"></v-icon>
                    <div class="icon-glow"></div>
                </div>
                
                <h2 class="text-h3 font-weight-black text-white mb-2 tracking-wide title-gradient">
                  BIENVENIDO
                </h2>
                <p class="text-subtitle-1 text-grey-lighten-3 font-weight-light">
                  Ingresa al Sistema Central
                </p>
              </div>
              
              <v-alert
                v-if="authError"
                type="error"
                variant="outlined"
                icon="mdi-alert-circle"
                class="mb-6 glass-alert"
                border="start"
                theme="dark"
              >
                {{ authError }}
              </v-alert>

              <v-alert
                v-if="registrationNotice"
                type="success"
                variant="outlined"
                icon="mdi-check-circle"
                class="mb-6 glass-alert"
                border="start"
                theme="dark"
              >
                {{ registrationNotice }}
              </v-alert>

              <v-alert
                v-if="supabaseWarning"
                type="warning"
                variant="outlined"
                class="mb-6 glass-alert"
                theme="dark"
              >
                {{ supabaseWarning }}
              </v-alert>

              <v-form @submit.prevent="onSubmit" class="mt-6">
                <!-- Email Input -->
                <div class="mb-5 input-wrapper">
                  <span class="input-label">Correo Electrónico</span>
                  <v-text-field
                    v-model="email"
                    placeholder="tucorreo@ejemplo.com"
                    type="email"
                    autocomplete="email"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    base-color="transparent"
                    color="white"
                    prepend-inner-icon="mdi-email"
                    class="epic-input"
                    hide-details="auto"
                    required
                    flat
                    theme="dark"
                  />
                </div>

                <!-- Password Input -->
                <div class="mb-8 input-wrapper">
                  <span class="input-label">Contraseña</span>
                  <v-text-field
                    v-model="password"
                    placeholder="••••••••••••"
                    type="password"
                    autocomplete="current-password"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    base-color="transparent"
                    color="white"
                    prepend-inner-icon="mdi-key"
                    class="epic-input"
                    hide-details="auto"
                    required
                    flat
                    theme="dark"
                  />
                </div>

                <v-btn
                  block
                  size="x-large"
                  type="submit"
                  :loading="auth.loading"
                  class="epic-btn text-white font-weight-bold mb-8"
                  height="64"
                >
                  <span class="text-h6 font-weight-bold">ACCEDER AHORA</span>
                  <v-icon end icon="mdi-chevron-right" size="large" class="ml-2"></v-icon>
                </v-btn>

                <div class="text-center position-relative">
                   <div class="separator mb-6 text-caption text-grey">o continúa al sitio público</div>
                   
                  <v-btn
                    href="https://avivamientomonterrey.com/"
                    block
                    variant="outlined"
                    size="large"
                    class="website-btn text-none"
                    height="54"
                  >
                    <v-icon start icon="mdi-web" class="mr-2"></v-icon>
                    Ir al Sitio Web Principal
                  </v-btn>
                </div>
              </v-form>
              
              <!-- Footer Text -->
              <div class="text-center position-relative mt-6">
                <div class="separator mb-4 text-caption text-grey">¿no tienes cuenta?</div>

                <v-btn
                  to="/signup"
                  block
                  variant="outlined"
                  size="large"
                  class="website-btn text-none"
                  height="50"
                >
                  <v-icon start icon="mdi-church" class="mr-2"></v-icon>
                  Crear Cuenta Gratis
                </v-btn>
              </div>

              <div class="mt-6 text-center text-caption text-grey-darken-1 font-weight-medium">
                 AVIVA CHECK v2.0 &copy; {{ new Date().getFullYear() }}
              </div>
            </v-card>
          </v-col>
        </v-row>
      </v-main>
    </v-app>
  </ClientOnly>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'

useHead({ title: 'Login - Aviva Check' })
definePageMeta({ layout: false })

const auth = useAuthStore()
const route = useRoute()

const email = ref('')
const password = ref('')

const authError = computed(() => auth.error)

const registrationNotice = computed(() => {
  return route.query.registered === '1'
    ? 'Cuenta creada correctamente. Inicia sesiÃ³n para terminar la configuraciÃ³n.'
    : ''
})

const supabaseWarning = computed(() => {
  const e = auth.error || ''
  if (e.toLowerCase().includes('supabase')) return e
  return ''
})

const redirectPath = computed(() => {
  const r = route.query.redirect
  if (typeof r !== 'string') return ''
  if (!r.startsWith('/')) return ''
  return r
})

onMounted(async () => {
  await auth.init()
  if (auth.isLoggedIn && auth.hasProfile) {
    await goAfterLogin()
  }
})

async function goAfterLogin() {
  if (redirectPath.value) {
    return navigateTo(redirectPath.value)
  }
  if (auth.profile?.role === 'pastor' && auth.profile?.onboarding_completed === false) {
    return navigateTo('/onboarding')
  }
  if (auth.canAccessPos) return navigateTo('/page/POS/pointOfSales')
  if (auth.canAccessKds) return navigateTo('/page/POS/kds')
  if (auth.canViewReports) return navigateTo('/page/POS/reports')
  return navigateTo('/forbidden?reason=role')
}

async function onSubmit() {
  try {
    await auth.signIn(email.value.trim(), password.value)
    await goAfterLogin()
  } catch {
    // Error handled in store
  }
}
</script>

<style scoped>
.login-container {
  background: #09090b; 
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  position: fixed;
  top: 0;
  left: 0;
}

/* Efecto Kenburns en Imagen */
.image-kenburns {
  animation: kenburns 40s infinite alternate;
  filter: brightness(0.8) contrast(1.1);
}
@keyframes kenburns {
  from { transform: scale(1); }
  to { transform: scale(1.15); }
}

.image-overlay {
  background: linear-gradient(to right, rgba(9,9,11,1) 0%, rgba(9,9,11,0) 20%),
              linear-gradient(to top, rgba(9,9,11,1) 0%, rgba(9,9,11,0.4) 50%, rgba(9,9,11,0.2) 100%);
  height: 100%;
  width: 100%;
}

.glass-text-box {
  padding: 32px;
  border-left: 4px solid #3b82f6;
  background: linear-gradient(90deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 100%);
  backdrop-filter: blur(4px);
  max-width: 90%;
}

/* Panel Derecho - Fondo Oscuro */
.bg-dark-gradient {
  background: #09090b;
  position: relative;
  overflow: hidden;
}

/* Orbes Decorativos de Fondo */
.bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.15;
  z-index: 0;
}
.orb-1 {
  width: 600px;
  height: 600px;
  background: #2563eb; 
  top: -200px;
  right: -200px;
}
.orb-2 {
  width: 500px;
  height: 500px;
  background: #7c3aed; 
  bottom: -150px;
  left: -150px;
}

/* Tarjeta Glassmorphism SUPERIOR */
.glass-card {
  background: rgba(20, 20, 24, 0.6);
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 32px;
  box-shadow: 0 0 0 1px rgba(0,0,0,1), 0 50px 100px -20px rgba(0,0,0,0.8);
  z-index: 10;
}

/* Icon Container */
.icon-container {
  width: 80px;
  height: 80px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(37, 99, 235, 0.1));
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border: 1px solid rgba(59, 130, 246, 0.3);
  box-shadow: 0 0 30px rgba(59, 130, 246, 0.2);
}
.shield-icon {
  filter: drop-shadow(0 0 10px rgba(96, 165, 250, 0.5));
}

/* Título Gradiente */
.title-gradient {
  background: linear-gradient(to right, #ffffff, #94a3b8);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: 0.05em;
}

/* Labels de Inputs */
.input-label {
  display: block;
  color: #94a3b8;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 8px;
  margin-left: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Inputs Épicos */
.epic-input :deep(.v-field) {
  border-radius: 16px !important;
  border: 1px solid rgba(255,255,255,0.08);
  transition: all 0.3s ease;
}
.epic-input :deep(.v-field--focused) {
  background: rgba(59, 130, 246, 0.1) !important;
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
}
.epic-input :deep(input) {
  font-size: 1.1rem;
  padding-top: 20px;
  padding-bottom: 20px;
}
.epic-input :deep(.v-icon) {
  opacity: 0.7;
}

/* Botón de Acción Principal */
.epic-btn {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
  border-radius: 16px;
  letter-spacing: 0.05em;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid rgba(255,255,255,0.1);
}
.epic-btn:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 20px 40px -12px rgba(37, 99, 235, 0.5);
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
}

/* Separador elegante */
.separator {
  display: flex;
  align-items: center;
  text-align: center;
}
.separator::before,
.separator::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.separator:not(:empty)::before {
  margin-right: .5em;
}
.separator:not(:empty)::after {
  margin-left: .5em;
}

/* Botón Website */
.website-btn {
  border-color: rgba(255, 255, 255, 0.2) !important;
  color: #e2e8f0 !important;
  border-radius: 16px;
  font-family: inherit;
  font-weight: 500;
  letter-spacing: 0.025em;
  background: rgba(255,255,255,0.02);
  transition: all 0.3s ease;
}
.website-btn:hover {
  background: rgba(255,255,255,0.08);
  border-color: white !important;
  color: white !important;
}

/* Alertas */
.glass-alert {
  background: rgba(239, 68, 68, 0.1) !important;
  border: 1px solid rgba(239, 68, 68, 0.2) !important;
  color: #fca5a5 !important;
  border-radius: 12px;
}
</style>
