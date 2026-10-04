<template>
  <ClientOnly>
    <v-app>
      <v-main class="signup-container pa-0">
        <v-row no-gutters class="fill-height">
          <!-- Left Panel: Cinematic Image (Matching login.vue) -->
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
                <p class="text-body-2 text-grey-lighten-2 mt-4" style="opacity: 0.75">
                  Registra tu iglesia y comienza a gestionar ventas, inventario y equipo en minutos.
                </p>
              </div>
            </div>
            
            <!-- Gradient Overlay (Background) -->
            <div class="image-overlay position-absolute" style="top: 0; left: 0; width: 100%; height: 100%; z-index: 1;"></div>
          </v-col>

          <!-- Right Panel: Registration Form -->
          <v-col cols="12" md="6" lg="6" class="d-flex align-center justify-center bg-dark-gradient position-relative">
            <div class="bg-orb orb-1"></div>
            <div class="bg-orb orb-2"></div>

            <v-card width="100%" max-width="520" class="glass-card ma-4 pa-8" elevation="24">
              <!-- Header -->
              <div class="text-center mb-6">
                <div class="icon-container mb-5 mx-auto">
                  <v-icon icon="mdi-church" size="48" color="white" class="shield-icon"></v-icon>
                  <div class="icon-glow"></div>
                </div>

                <h2 class="text-h4 font-weight-black text-white mb-2 tracking-wide title-gradient">
                  REGISTRA TU IGLESIA
                </h2>
                <p class="text-subtitle-1 text-grey-lighten-3 font-weight-light">
                  Crea tu cuenta y empieza a vender hoy
                </p>
              </div>

              <v-alert
                v-if="error"
                type="error"
                variant="outlined"
                icon="mdi-alert-circle"
                class="mb-5 glass-alert"
                border="start"
                theme="dark"
              >
                {{ error }}
              </v-alert>

              <v-alert
                v-if="success"
                type="success"
                variant="outlined"
                icon="mdi-check-circle"
                class="mb-5 glass-alert"
                border="start"
                theme="dark"
              >
                {{ success }}
              </v-alert>

              <v-form @submit.prevent="handleSignup">
                <!-- Full Name -->
                <div class="mb-4 input-wrapper">
                  <span class="input-label">Tu Nombre Completo</span>
                  <v-text-field
                    v-model="form.full_name"
                    placeholder="Juan Pérez"
                    autocomplete="name"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    base-color="transparent"
                    color="white"
                    prepend-inner-icon="mdi-account"
                    class="epic-input"
                    hide-details="auto"
                    :rules="[v => !!v || 'Nombre requerido']"
                    required
                    flat
                    theme="dark"
                  />
                </div>

                <!-- Email -->
                <div class="mb-4 input-wrapper">
                  <span class="input-label">Correo Electrónico</span>
                  <v-text-field
                    v-model="form.email"
                    placeholder="tucorreo@iglesia.com"
                    type="email"
                    autocomplete="email"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    base-color="transparent"
                    color="white"
                    prepend-inner-icon="mdi-email"
                    class="epic-input"
                    hide-details="auto"
                    :rules="[v => !!v || 'Email requerido']"
                    required
                    flat
                    theme="dark"
                  />
                </div>

                <!-- Password -->
                <div class="mb-4 input-wrapper">
                  <span class="input-label">Contraseña</span>
                  <v-text-field
                    v-model="form.password"
                    placeholder="••••••••••••"
                    :type="showPassword ? 'text' : 'password'"
                    autocomplete="new-password"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    base-color="transparent"
                    color="white"
                    prepend-inner-icon="mdi-lock"
                    :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                    @click:append-inner="showPassword = !showPassword"
                    class="epic-input"
                    hide-details="auto"
                    hint="Mínimo 6 caracteres"
                    :rules="[v => v.length >= 6 || 'Mínimo 6 caracteres']"
                    required
                    flat
                    theme="dark"
                  />
                </div>

                <!-- Church Name -->
                <div class="mb-6 input-wrapper">
                  <span class="input-label">Nombre de tu Iglesia</span>
                  <v-text-field
                    v-model="form.church_name"
                    placeholder="Iglesia Nueva Vida"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    base-color="transparent"
                    color="white"
                    prepend-inner-icon="mdi-church"
                    class="epic-input"
                    hide-details="auto"
                    :rules="[v => v.length >= 3 || 'Mínimo 3 caracteres']"
                    required
                    flat
                    theme="dark"
                  />
                </div>

                <v-btn
                  block
                  size="x-large"
                  type="submit"
                  :loading="loading"
                  :disabled="!isFormValid"
                  class="epic-btn text-white font-weight-bold mb-6"
                  height="60"
                >
                  <v-icon start icon="mdi-rocket-launch" class="mr-2"></v-icon>
                  <span class="text-h6 font-weight-bold">CREAR CUENTA GRATIS</span>
                </v-btn>

                <div class="text-center position-relative">
                  <div class="separator mb-5 text-caption text-grey">¿ya tienes cuenta?</div>

                  <v-btn
                    to="/login"
                    block
                    variant="outlined"
                    size="large"
                    class="website-btn text-none"
                    height="50"
                  >
                    <v-icon start icon="mdi-login" class="mr-2"></v-icon>
                    Iniciar Sesión
                  </v-btn>
                </div>
              </v-form>

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
import { computed, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useSupabase } from '../composables/useSupabase'

useHead({ title: 'Registrarse - Aviva Check' })
definePageMeta({ layout: false })

const auth = useAuthStore()

const form = ref({
  full_name: '',
  email: '',
  password: '',
  church_name: '',
})

const loading = ref(false)
const error = ref('')
const success = ref('')
const showPassword = ref(false)

const isFormValid = computed(() => {
  return (
    form.value.full_name.length > 0 &&
    form.value.email.length > 0 &&
    form.value.password.length >= 6 &&
    form.value.church_name.length >= 3
  )
})

async function handleSignup() {
  if (!isFormValid.value) return

  loading.value = true
  error.value = ''
  success.value = ''

  try {
    const result = await auth.signUp(form.value.email.trim(), form.value.password, {
      full_name: form.value.full_name.trim(),
      church_name: form.value.church_name.trim(),
    })

    if (result?.requiresLogin) {
      success.value = 'Cuenta creada correctamente. Inicia sesión para terminar la configuración.'
      await navigateTo('/login?registered=1')
      return
    }

    // Completar onboarding automáticamente para permitir acceso directo al panel de administración
    const sb = useSupabase()
    if (sb?.rpc) {
      await sb.rpc('complete_onboarding')
      await auth.refreshProfile()
    }

    // Redirigir directamente al panel de gestión de personal
    await navigateTo('/page/POS/users')
  } catch (err: any) {
    error.value = err?.message || 'Error al crear la cuenta. Intenta de nuevo.'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.signup-container {
  background: #09090b;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  position: fixed;
  top: 0;
  left: 0;
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

.bg-dark-gradient {
  background: #09090b;
  position: relative;
  overflow: hidden;
}

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

.glass-card {
  background: rgba(20, 20, 24, 0.6);
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 32px;
  box-shadow: 0 0 0 1px rgba(0,0,0,1), 0 50px 100px -20px rgba(0,0,0,0.8);
  z-index: 10;
}

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

.title-gradient {
  background: linear-gradient(to right, #ffffff, #94a3b8);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  letter-spacing: 0.05em;
}

.input-label {
  display: block;
  color: #94a3b8;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 6px;
  margin-left: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

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
  font-size: 1.05rem;
  padding-top: 18px;
  padding-bottom: 18px;
}
.epic-input :deep(.v-icon) {
  opacity: 0.7;
}

.epic-btn {
  background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%) !important;
  color: #ffffff !important;
  border-radius: 16px;
  letter-spacing: 0.05em;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid rgba(255,255,255,0.1);
}
.epic-btn:disabled,
.epic-btn.v-btn--disabled {
  background: rgba(30, 41, 59, 0.7) !important;
  color: rgba(148, 163, 184, 0.45) !important;
  border: 1px solid rgba(255, 255, 255, 0.05) !important;
  opacity: 0.7 !important;
  cursor: not-allowed !important;
}
.epic-btn:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 20px 40px -12px rgba(37, 99, 235, 0.5);
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%) !important;
}

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

.website-btn {
  border-color: rgba(255, 255, 255, 0.2) !important;
  color: #e2e8f0 !important;
  border-radius: 16px;
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

.glass-alert {
  background: rgba(239, 68, 68, 0.1) !important;
  border: 1px solid rgba(239, 68, 68, 0.2) !important;
  color: #fca5a5 !important;
  border-radius: 12px;
}
</style>
