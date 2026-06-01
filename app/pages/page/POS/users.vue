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
        Para crear usuarios de forma segura, utiliza una <strong>una contraseña temporal</strong>. Nunca expongas <strong>tus credenciales.</strong>
      </v-alert>

      <v-row>
        <v-col cols="12" lg="4">
          <v-card elevation="2" class="pa-4 h-100" rounded="xl" border>
            <div class="text-h6 font-weight-bold mb-4">Crear Nuevo Usuario</div>
            
            <v-text-field 
              v-model="newName" 
              label="Nombre completo" 
              variant="outlined" 
              class="mb-2"
              prepend-inner-icon="mdi-account"
            />
            <v-text-field 
              v-model="newEmail" 
              label="Email" 
              type="email" 
              variant="outlined" 
              class="mb-2"
              prepend-inner-icon="mdi-email"
              placeholder="nombre@dominio.com"
              hint="Formato obligatorio: usuario@dominio.algo (ej: juan@tienda.colonia)"
              persistent-hint
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
                      <v-menu v-if="p.id !== auth.profile?.id && p.email !== 'admin@genesis.com'">
                        <template v-slot:activator="{ props }">
                          <v-btn icon="mdi-dots-vertical" size="small" variant="text" v-bind="props" />
                        </template>
                        <v-list density="compact" rounded="lg">
                          <template v-if="getEditableRolesFor(p).length > 0">
                            <v-list-subheader>Cambiar Rol</v-list-subheader>
                            <v-list-item 
                              v-for="r in getEditableRolesFor(p)" 
                              :key="r.value"
                              :title="r.title"
                              :prepend-icon="p.role === r.value ? 'mdi-check-circle' : 'mdi-circle-outline'"
                              :disabled="p.role === r.value"
                              @click="changeRole(p, r.value)"
                            />
                            <v-divider class="my-1" />
                          </template>
                          <template v-if="p.role === 'cashier' || p.role === 'leader'">
                          <v-list-item 
                            :title="p.auto_accept_orders ? 'Auto-completar: ON' : 'Auto-completar: OFF'" 
                            :subtitle="p.auto_accept_orders ? 'Ventas se aceptan sin pasar por cocina' : 'Ventas pasan a KDS para aprobación'"
                            :prepend-icon="p.auto_accept_orders ? 'mdi-lightning-bolt' : 'mdi-lightning-bolt-outline'"
                            :base-color="p.auto_accept_orders ? 'success' : 'grey'"
                            @click="toggleAutoAccept(p)"
                          >
                            <template v-slot:append>
                              <v-switch 
                                :model-value="p.auto_accept_orders" 
                                hide-details 
                                density="compact"
                                color="success"
                                readonly
                              />
                            </template>
                          </v-list-item>
                          <v-divider class="my-1" />
                          </template>
                          <v-list-item 
                            title="Eliminar Usuario" 
                            prepend-icon="mdi-delete-alert" 
                            base-color="error"
                            @click="deactivateUser(p)"
                          />
                        </v-list>
                      </v-menu>
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
import { computed, onMounted, ref, watchEffect } from 'vue'
import { useAuthStore } from '../../../stores/auth'
import { useToast } from '../../../composables/useToast'
import { useSupabase } from '../../../composables/useSupabase'
import type { AppRole, Profile } from '../../../types'
import { createClient } from '@supabase/supabase-js'
import { APP_ROLES, SUPER_ADMIN_CREATABLE_ROLES, PASTOR_ASSIGNABLE_ROLES, STAFF_ROLES, getRoleTitle, getRoleColor } from '../../../utils/roles'

definePageMeta({ middleware: ['auth', 'role-leader'], layout: 'sistema' })
useHead({ title: 'Usuarios - Aviva Check' })

const auth = useAuthStore()
const toast = useToast()

const profiles = ref<Profile[]>([])
const loading = ref(false)
const listWarning = ref('')

const newName = ref('')
const newEmail = ref('')
const newPassword = ref('')
const newRole = ref<AppRole>('pastor')
const creating = ref(false)
const createWarning = ref('')

const roleOptions = computed(() => {
  if (auth.role === 'super_admin') return SUPER_ADMIN_CREATABLE_ROLES
  if (auth.role === 'pastor') return PASTOR_ASSIGNABLE_ROLES
  if (auth.role === 'leader') return STAFF_ROLES
  return []
})

watchEffect(() => {
  const firstAllowedRole = roleOptions.value[0]?.value as AppRole | undefined
  if (firstAllowedRole && !roleOptions.value.some(r => r.value === newRole.value)) {
    newRole.value = firstAllowedRole
  }
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

function getSupabase() {
  try { return useSupabase() } catch { return null }
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
    let data: any[] = []

    if (auth.role === 'super_admin') {
      // Super Admin: ve TODOS los usuarios
      const { data: all, error } = await sb
        .from('profiles')
        .select('id,email,display_name,org_id,owner_id,role,created_at,auto_accept_orders')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      data = all ?? []

    } else if (auth.role === 'pastor' && auth.profile?.id) {
      // Pastor: ve sus líderes (owner_id = pastor) + staff de esos líderes
      const { data: directReports, error: e1 } = await sb
        .from('profiles')
        .select('id,email,display_name,org_id,owner_id,role,created_at,auto_accept_orders')
        .eq('owner_id', auth.profile.id)
        .order('created_at', { ascending: false })
      if (e1) throw e1

      const leaders = (directReports ?? []).filter((p: any) => p.role === 'leader')
      
      if (leaders.length > 0) {
        const leaderIds = leaders.map((l: any) => l.id)
        const { data: staffOfLeaders, error: e2 } = await sb
          .from('profiles')
          .select('id,email,display_name,org_id,owner_id,role,created_at,auto_accept_orders')
          .in('owner_id', leaderIds)
          .order('created_at', { ascending: false })
        if (e2) throw e2
        data = [...(directReports ?? []), ...(staffOfLeaders ?? [])]
      } else {
        data = directReports ?? []
      }

    } else if (auth.role === 'leader' && auth.profile?.id) {
      // Leader: ve SOLO su staff (owner_id = leader's ID)
      const { data: staff, error } = await sb
        .from('profiles')
        .select('id,email,display_name,org_id,owner_id,role,created_at,auto_accept_orders')
        .eq('owner_id', auth.profile.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      data = staff ?? []

    } else if (auth.profile?.org_id) {
      // Fallback: filtra por org_id
      const { data: orgUsers, error } = await sb
        .from('profiles')
        .select('id,email,display_name,org_id,owner_id,role,created_at,auto_accept_orders')
        .eq('org_id', auth.profile.org_id)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      data = orgUsers ?? []
    }

    profiles.value = data as Profile[]
  } catch (e: any) {
    listWarning.value = e?.message ?? String(e)
    toast.error('Error cargando perfiles')
  } finally {
    loading.value = false
  }
}

// Returns the roles that the current user can assign to a target profile
function getEditableRolesFor(profile: Profile) {
  // Prevent editing yourself or the master admin
  if (profile.id === auth.profile?.id) return []
  if (profile.email === 'admin@genesis.com') return []
  
  // Super Admin can change ANY role
  if (auth.role === 'super_admin') {
    return APP_ROLES
  }
  
  // Pastor: solo puede cambiar roles de staff (cashier↔kitchen)
  // NO puede degradar a un líder — eso rompería la jerarquía
  if (auth.role === 'pastor') {
    if (profile.role === 'cashier' || profile.role === 'kitchen') return STAFF_ROLES
    return [] // Líder no se puede cambiar
  }
  
  // Leader: solo puede cambiar su staff (cashier↔kitchen)
  if (auth.role === 'leader') {
    if (profile.role === 'cashier' || profile.role === 'kitchen') {
      return STAFF_ROLES
    }
  }
  
  return []
}

async function changeRole(profile: Profile, newRoleValue: string) {
  const sb = getSupabase()
  if (!sb?.from) return

  try {
    const { error } = await sb
      .from('profiles')
      .update({ role: newRoleValue })
      .eq('id', profile.id)

    if (error) throw error

    toast.success(`Rol cambiado a ${getRoleTitle(newRoleValue)}`)
    await loadProfiles()
  } catch (e: any) {
    toast.error('Error al cambiar rol: ' + (e?.message ?? String(e)))
  }
}

async function toggleAutoAccept(profile: Profile) {
  const sb = getSupabase()
  if (!sb?.from) return

  const newValue = !profile.auto_accept_orders
  
  try {
    const { error } = await sb
      .from('profiles')
      .update({ auto_accept_orders: newValue })
      .eq('id', profile.id)

    if (error) throw error

    // Update local state
    profile.auto_accept_orders = newValue
    toast.success(newValue ? 'Auto-completar activado' : 'Auto-completar desactivado')
  } catch (e: any) {
    toast.error('Error: ' + (e?.message ?? String(e)))
  }
}

async function deactivateUser(profile: Profile) {
  if (profile.email === 'admin@genesis.com') return
  if (!confirm(`¿Seguro que deseas eliminar a ${profile.display_name || profile.email}?\n\nSe borrarán sus datos, productos, órdenes y usuarios subordinados.\nEsta acción NO se puede deshacer.`)) return

  const sb = getSupabase()
  if (!sb?.rpc) return

  loading.value = true
  try {
    const { error } = await sb.rpc('delete_user_cascade', {
      target_user_id: profile.id
    })

    if (error) throw error

    toast.success('Usuario eliminado completamente')
    profiles.value = profiles.value.filter(p => p.id !== profile.id)
  } catch (e: any) {
    toast.error('Error al eliminar: ' + (e?.message ?? String(e)))
  } finally {
    loading.value = false
  }
}

async function deleteUser(profile: Profile) {
  // Super Admin usa el mismo flujo
  if (auth.role !== 'super_admin') {
    toast.error('Solo Super Admin puede eliminar usuarios')
    return
  }
  if (profile.email === 'admin@genesis.com') {
    toast.error('No puedes eliminar la cuenta maestra')
    return
  }
  
  // Reusar la misma función de cascada
  await deactivateUser(profile)
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
        user_role: role,
        user_display_name: newName.value.trim() || null
      })
      
      if (rpcError) throw rpcError
      
      toast.success('Usuario creado y provisionado exitosamente')
      
      newName.value = ''
      newEmail.value = ''
      newPassword.value = ''
      newRole.value = (roleOptions.value[0]?.value as AppRole) || 'cashier'
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
