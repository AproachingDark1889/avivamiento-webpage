<template>
  <div class="pa-4 h-100 d-flex flex-column">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4 font-weight-black text-primary">
        <v-icon start size="36">mdi-account-group</v-icon>Gestión de Usuarios
      </h1>
      <v-spacer />
      <v-chip color="secondary" variant="flat" class="font-weight-bold ml-2">{{ auth.role || '—' }}</v-chip>
    </div>

    <div class="flex-grow-1 overflow-y-auto">
      <v-alert type="info" variant="tonal" class="mb-4" density="compact" rounded="lg" icon="mdi-shield-lock-outline">
        Para crear usuarios de forma segura, utiliza una <strong>Edge Function</strong>. Nunca expongas la <code>service_role</code> key en el cliente.
      </v-alert>

      <v-row>
        <v-col cols="12" lg="4">
          <v-card elevation="2" class="pa-4 h-100" rounded="xl" border>
            <div class="text-h6 font-weight-bold mb-4">Crear Nuevo Usuario</div>
            
            <v-text-field 
              v-model="newEmail" 
              label="Email" 
              type="email" 
              variant="outlined" 
              class="mb-2"
              prepend-inner-icon="mdi-email"
            />
            <v-text-field 
              v-model="newPassword" 
              label="Contraseña (opcional)" 
              type="password" 
              variant="outlined" 
              class="mb-2"
              prepend-inner-icon="mdi-lock"
            />
            <v-select
              v-model="newRole"
              :items="roleOptions"
              item-title="title"
              item-value="value"
              label="Rol"
              variant="outlined"
              class="mb-4"
              prepend-inner-icon="mdi-badge-account"
            />

            <v-btn
              color="primary"
              block
              size="large"
              :loading="creating"
              :disabled="!canCreate"
              @click="createUser"
              rounded="lg"
            >
              <v-icon start>mdi-plus-circle</v-icon> Crear Usuario
            </v-btn>

            <v-alert v-if="createWarning" type="warning" variant="tonal" class="mt-4" density="compact">
              {{ createWarning }}
            </v-alert>
          </v-card>
        </v-col>

        <v-col cols="12" lg="8">
          <v-card elevation="2" class="pa-4 h-100 d-flex flex-column" rounded="xl" border>
            <div class="d-flex align-center mb-4">
              <div class="text-h6 font-weight-bold">Usuarios Existentes</div>
              <v-spacer />
              <v-btn 
                color="primary" 
                variant="text" 
                icon="mdi-refresh" 
                :loading="loading" 
                @click="loadProfiles"
              />
            </div>

            <v-alert v-if="listWarning" type="warning" variant="tonal" class="mb-4" density="compact">
              {{ listWarning }}
            </v-alert>

            <v-divider class="mb-2" />

            <div class="flex-grow-1 overflow-y-auto">
              <v-table density="compact" hover>
                <thead>
                  <tr>
                    <th class="text-left">Nombre / Email</th>
                    <th class="text-left">Rol</th>
                    <th class="text-left">Creado</th>
                    <th class="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in profiles" :key="p.id">
                    <td>
                      <div class="font-weight-bold">{{ p.display_name || p.email }}</div>
                      <div class="text-caption text-medium-emphasis">{{ p.email }}</div>
                    </td>
                    <td>
                      <v-chip size="x-small" :color="getRoleColor(p.role)" variant="flat" class="text-uppercase font-weight-bold">
                        {{ getRoleTitle(p.role) }}
                      </v-chip>
                    </td>
                    <td class="text-caption">{{ formatTime(p.created_at) }}</td>
                    <td class="text-right">
                       <v-btn icon="mdi-dots-vertical" size="small" variant="text" disabled></v-btn>
                    </td>
                  </tr>
                  <tr v-if="profiles.length === 0">
                    <td colspan="4" class="text-center pa-8 text-medium-emphasis">
                      <v-icon size="48" class="mb-2">mdi-account-off</v-icon>
                      <div>Sin usuarios encontrados</div>
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '../../../stores/auth'
import { useToast } from '../../../composables/useToast'
import type { AppRole, Profile } from '../../../types'
import { createClient } from '@supabase/supabase-js'
import { APP_ROLES, getRoleTitle, getRoleColor } from '../../../utils/roles'

definePageMeta({ middleware: ['auth', 'role-leader'], layout: 'sistema' })
useHead({ title: 'Usuarios - Aviva Check' })

const auth = useAuthStore()
const toast = useToast()

const profiles = ref<Profile[]>([])
const loading = ref(false)
const listWarning = ref('')

const newEmail = ref('')
const newPassword = ref('')
const newRole = ref<AppRole>('cashier')
const creating = ref(false)
const createWarning = ref('')

const roleOptions = computed(() => {
  // Super Admin can create Leaders. Leaders can only create Staff.
  if (auth.role === 'super_admin') return APP_ROLES
  return APP_ROLES.filter(r => r.value !== 'leader')
})

const canCreate = computed(() => {
  if (creating.value) return false
  if (!newEmail.value.trim()) return false
  // Check if val is in our active options
  if (!roleOptions.value.find(r => r.value === newRole.value)) return false
  return true
})

function formatTime(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getSupabase(): any | null {
  const nuxtApp = useNuxtApp() as any
  return nuxtApp?.$supabase || nuxtApp?.$supabaseClient || null
}

onMounted(() => {
  loadProfiles()
})

async function loadProfiles() {
  listWarning.value = ''
  const sb = getSupabase()
  if (!sb?.from) {
    listWarning.value = 'Supabase no detectado en runtime.'
    return
  }

  loading.value = true
  try {
    const { data, error } = await sb
      .from('profiles')
      .select('id,email,display_name,org_id,role,created_at')
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) throw error
    profiles.value = (data ?? []) as Profile[]
  } catch (e: any) {
    listWarning.value = e?.message ?? String(e)
    toast.error('Error cargando perfiles')
  } finally {
    loading.value = false
  }
}

async function createUser() {
  createWarning.value = ''
  const sb = getSupabase()
  if (!sb?.auth) {
    createWarning.value = 'Supabase auth no detectado.'
    return
  }

  creating.value = true
  try {
    const email = newEmail.value.trim()
    const password = newPassword.value || '123456'
    const role = newRole.value

    // A. Crear "Cliente Fantasma" temporal para no cerrar la sesión del Admin
    const config = useRuntimeConfig()
    const tempSupabase = createClient(
      config.public.supabaseUrl, 
      config.public.supabaseKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false // IMPORTANTE: No guardar sesión en localStorage
        }
      }
    )

    // B. Crear el usuario legalmente (Auth)
    const { data: authData, error: authError } = await tempSupabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: { role: role } // Metadatos opcionales
      }
    })

    if (authError) throw authError

    // C. Si se creó, llamamos al RPC para asignarle su República (Lógica de Negocio)
    if (authData.user && authData.user.id) {
      const { error: rpcError } = await sb.rpc('provision_user_profile', {
        target_user_id: authData.user.id,
        user_email: email,
        user_role: role
      })
      
      if (rpcError) throw rpcError
      
      toast.success('Usuario creado y provisionado exitosamente')
      
      newEmail.value = ''
      newPassword.value = ''
      newRole.value = roleOptions.value[0] || 'cashier'
      await loadProfiles()
    } else {
      throw new Error('No se pudo obtener el ID del usuario creado')
    }

  } catch (e: any) {
    createWarning.value = e?.message ?? String(e)
    toast.error('Error al crear usuario')
  } finally {
    creating.value = false
  }
}

</script>
