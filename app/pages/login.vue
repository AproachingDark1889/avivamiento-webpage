<template>
  <ClientOnly>
    <v-app>
      <v-app-bar app color="primary" height="64">
        <v-container class="d-flex align-center">
          <v-toolbar-title style="color: white; font-weight: 800;">
            AVIVA CHECK — LOGIN
          </v-toolbar-title>

          <v-spacer />

          <v-btn href="/land" variant="text" style="color: white; text-transform: none;">
            Sitio
          </v-btn>
        </v-container>
      </v-app-bar>

      <v-main>
        <v-container class="pa-4" style="max-width: 520px;">
          <v-card elevation="2">
            <v-card-title style="font-weight: 800;">
              Iniciar sesión
            </v-card-title>

            <v-divider />

            <v-card-text>
              <v-alert
                v-if="authError"
                type="error"
                variant="tonal"
                class="mb-4"
              >
                {{ authError }}
              </v-alert>

              <v-alert
                v-if="supabaseWarning"
                type="warning"
                variant="tonal"
                class="mb-4"
              >
                {{ supabaseWarning }}
              </v-alert>

              <v-form @submit.prevent="onSubmit">
                <v-text-field
                  v-model="email"
                  label="Correo"
                  type="email"
                  autocomplete="email"
                  variant="outlined"
                  required
                />

                <v-text-field
                  v-model="password"
                  label="Contraseña"
                  type="password"
                  autocomplete="current-password"
                  variant="outlined"
                  required
                />

                <v-btn
                  color="primary"
                  block
                  size="large"
                  type="submit"
                  :loading="auth.loading"
                >
                  Entrar
                </v-btn>

                <div class="mt-3" style="opacity: 0.85; font-size: 14px;">
                  Si tu usuario no tiene rol asignado, serás redirigido a “Acceso denegado”.
                </div>
              </v-form>
            </v-card-text>
          </v-card>
        </v-container>
      </v-main>
    </v-app>
  </ClientOnly>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'

useHead({ title: 'Login - Génesis Sales Core' })
definePageMeta({ layout: false })

const auth = useAuthStore()
const route = useRoute()

const email = ref('')
const password = ref('')

const authError = computed(() => auth.error)

const supabaseWarning = computed(() => {
  // Si el store reportó error de supabase, lo mostramos como warning en UI
  const e = auth.error || ''
  if (e.toLowerCase().includes('supabase')) return e
  return ''
})

const redirectPath = computed(() => {
  const r = route.query.redirect
  if (typeof r !== 'string') return ''
  // Prevención de open redirect: solo paths internos
  if (!r.startsWith('/')) return ''
  return r
})

onMounted(async () => {
  await auth.init()
  if (auth.isLoggedIn && auth.hasProfile) {
    // Si ya está logueado, lo mandamos a donde corresponda
    await goAfterLogin()
  }
})

async function goAfterLogin() {
  if (redirectPath.value) {
    return navigateTo(redirectPath.value)
  }

  // Routing por rol
  if (auth.canAccessPos) return navigateTo('/sistema/pos')
  if (auth.canAccessKds) return navigateTo('/sistema/kds')
  if (auth.canViewReports) return navigateTo('/sistema/reportes')

  return navigateTo('/forbidden?reason=role')
}

async function onSubmit() {
  try {
    await auth.signIn(email.value.trim(), password.value)
    await goAfterLogin()
  } catch {
    // El mensaje ya queda en auth.error
  }
}
</script>
