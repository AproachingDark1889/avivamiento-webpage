<template>
  <ClientOnly>
    <v-app>
      <v-main class="onboarding-container">
        <v-container class="fill-height d-flex align-center justify-center" fluid>
          <v-card width="100%" max-width="640" class="glass-card pa-0" elevation="24">

            <!-- Progress Header -->
            <div class="pa-6 pb-0">
              <div class="d-flex align-center mb-2">
                <v-icon icon="mdi-church" color="blue-lighten-1" size="28" class="mr-3" />
                <span class="text-h6 font-weight-bold text-white">Configuración Inicial</span>
                <v-spacer />
                <v-chip size="small" color="blue" variant="tonal" class="font-weight-bold">
                  Paso {{ currentStep }} de 3
                </v-chip>
              </div>
              <v-progress-linear
                :model-value="(currentStep / 3) * 100"
                color="blue"
                height="4"
                rounded
                class="mt-2"
              />
            </div>

            <!-- Step Content -->
            <div class="pa-6">

              <!-- ═══════════════════════════════════════ -->
              <!-- STEP 1: Configura tu Iglesia           -->
              <!-- ═══════════════════════════════════════ -->
              <div v-if="currentStep === 1">
                <div class="step-header mb-6">
                  <div class="step-icon-box blue">
                    <v-icon size="32" color="white">mdi-cog</v-icon>
                  </div>
                  <div>
                    <h3 class="text-h5 font-weight-black text-white">Configura tu Iglesia</h3>
                    <p class="text-body-2 text-grey-lighten-1 mt-1">Personaliza los datos básicos de tu organización</p>
                  </div>
                </div>

                <div class="mb-4">
                  <span class="field-label">Nombre de la Iglesia</span>
                  <v-text-field
                    v-model="orgName"
                    placeholder="Iglesia Nueva Vida"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    color="white"
                    prepend-inner-icon="mdi-church"
                    class="epic-input"
                    hide-details
                    flat
                    theme="dark"
                  />
                  <p class="text-caption text-grey mt-1 ml-1">Puedes modificar el nombre de tu iglesia</p>
                </div>

                <div class="mb-4">
                  <span class="field-label">Teléfono (Opcional)</span>
                  <v-text-field
                    v-model="phone"
                    placeholder="+52 81 1234 5678"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    color="white"
                    prepend-inner-icon="mdi-phone"
                    class="epic-input"
                    hide-details
                    flat
                    theme="dark"
                  />
                </div>

                <div>
                  <span class="field-label">Dirección (Opcional)</span>
                  <v-text-field
                    v-model="address"
                    placeholder="Calle, Ciudad, Estado"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    color="white"
                    prepend-inner-icon="mdi-map-marker"
                    class="epic-input"
                    hide-details
                    flat
                    theme="dark"
                  />
                </div>
              </div>

              <!-- ═══════════════════════════════════════ -->
              <!-- STEP 2: Crea tu primer producto        -->
              <!-- ═══════════════════════════════════════ -->
              <div v-if="currentStep === 2">
                <div class="step-header mb-6">
                  <div class="step-icon-box green">
                    <v-icon size="32" color="white">mdi-package-variant-plus</v-icon>
                  </div>
                  <div>
                    <h3 class="text-h5 font-weight-black text-white">Crea tu Primer Producto</h3>
                    <p class="text-body-2 text-grey-lighten-1 mt-1">Para comenzar a vender, crea al menos un producto</p>
                  </div>
                </div>

                <div class="mb-4">
                  <span class="field-label">Nombre del Producto</span>
                  <v-text-field
                    v-model="productName"
                    placeholder="Café Americano"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    color="white"
                    prepend-inner-icon="mdi-tag"
                    class="epic-input"
                    hide-details
                    flat
                    theme="dark"
                  />
                </div>

                <div class="mb-4">
                  <span class="field-label">Precio (MXN)</span>
                  <v-text-field
                    v-model.number="productPrice"
                    placeholder="25.00"
                    type="number"
                    min="0"
                    step="0.50"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    color="white"
                    prepend-inner-icon="mdi-currency-usd"
                    class="epic-input"
                    hide-details
                    flat
                    theme="dark"
                  />
                </div>

                <div>
                  <span class="field-label">Categoría</span>
                  <v-select
                    v-model="productCategory"
                    :items="categoryOptions"
                    item-title="title"
                    item-value="value"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    color="white"
                    prepend-inner-icon="mdi-shape"
                    class="epic-input"
                    hide-details
                    flat
                    theme="dark"
                  />
                </div>

                <!-- Product Preview -->
                <v-card
                  v-if="productName && productPrice > 0"
                  variant="outlined"
                  class="mt-5 pa-4"
                  rounded="xl"
                  style="border-color: rgba(76, 175, 80, 0.3); background: rgba(76, 175, 80, 0.05)"
                >
                  <div class="d-flex align-center">
                    <v-avatar color="green" variant="tonal" size="40" class="mr-3">
                      <v-icon>mdi-package-variant</v-icon>
                    </v-avatar>
                    <div>
                      <div class="text-body-1 font-weight-bold text-white">{{ productName }}</div>
                      <div class="text-caption text-grey-lighten-1">{{ productCategory }} · {{ formatMoney(productPrice) }}</div>
                    </div>
                    <v-spacer />
                    <v-icon color="green-lighten-2">mdi-check-circle</v-icon>
                  </div>
                </v-card>
              </div>

              <!-- ═══════════════════════════════════════ -->
              <!-- STEP 3: Registra a tu primer líder      -->
              <!-- ═══════════════════════════════════════ -->
              <div v-if="currentStep === 3">
                <div class="step-header mb-6">
                  <div class="step-icon-box purple">
                    <v-icon size="32" color="white">mdi-account-plus</v-icon>
                  </div>
                  <div>
                    <h3 class="text-h5 font-weight-black text-white">Registra a tu Primer Líder</h3>
                    <p class="text-body-2 text-grey-lighten-1 mt-1">Un líder gestiona un departamento (ej: Cafetería). Puedes usar un email ficticio.</p>
                  </div>
                </div>

                <v-alert
                  type="info"
                  variant="tonal"
                  density="compact"
                  class="mb-5"
                  theme="dark"
                  icon="mdi-information"
                >
                  Este paso es <strong>opcional</strong>. Puedes registrar líderes después desde Gestión de Usuarios.
                </v-alert>

                <div class="mb-4">
                  <span class="field-label">Email del Líder</span>
                  <v-text-field
                    v-model="leaderEmail"
                    placeholder="lider@iglesia.com"
                    type="email"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    color="white"
                    prepend-inner-icon="mdi-email"
                    class="epic-input"
                    hide-details
                    flat
                    theme="dark"
                  />
                </div>

                <div class="mb-4">
                  <span class="field-label">Nombre del Líder</span>
                  <v-text-field
                    v-model="leaderName"
                    placeholder="Juan Pérez"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    color="white"
                    prepend-inner-icon="mdi-account"
                    class="epic-input"
                    hide-details
                    flat
                    theme="dark"
                  />
                </div>

                <div>
                  <span class="field-label">Contraseña Temporal</span>
                  <v-text-field
                    v-model="leaderPassword"
                    placeholder="contraseña123"
                    variant="solo"
                    bg-color="rgba(0,0,0,0.3)"
                    color="white"
                    prepend-inner-icon="mdi-lock"
                    class="epic-input"
                    hide-details
                    hint="El líder debe cambiarla después"
                    flat
                    theme="dark"
                  />
                </div>
              </div>
            </div>

            <!-- Alert -->
            <div class="px-6" v-if="error">
              <v-alert type="error" variant="tonal" density="compact" class="mb-0" theme="dark" closable @click:close="error = ''">
                {{ error }}
              </v-alert>
            </div>

            <!-- Navigation -->
            <div class="pa-6 pt-4 d-flex align-center">
              <v-btn
                v-if="currentStep > 1"
                variant="text"
                color="grey-lighten-1"
                prepend-icon="mdi-arrow-left"
                @click="prevStep"
                :disabled="loading"
              >
                Atrás
              </v-btn>

              <v-spacer />

              <!-- Skip (solo Step 3) -->
              <v-btn
                v-if="currentStep === 3"
                variant="text"
                color="grey"
                class="mr-3"
                @click="finishOnboarding"
                :disabled="loading"
              >
                Saltar
              </v-btn>

              <v-btn
                v-if="currentStep < 3"
                color="blue"
                variant="flat"
                append-icon="mdi-arrow-right"
                @click="nextStep"
                :loading="loading"
                :disabled="!canProceed"
                size="large"
                class="font-weight-bold"
                rounded="lg"
              >
                Siguiente
              </v-btn>

              <v-btn
                v-if="currentStep === 3"
                color="green"
                variant="flat"
                append-icon="mdi-check"
                @click="finishWithLeader"
                :loading="loading"
                :disabled="currentStep === 3 && leaderEmail.length > 0 && (!leaderName || !leaderPassword)"
                size="large"
                class="font-weight-bold"
                rounded="lg"
              >
                Finalizar
              </v-btn>
            </div>
          </v-card>
        </v-container>

        <!-- Background Orbs -->
        <div class="bg-orb orb-1"></div>
        <div class="bg-orb orb-2"></div>
        <div class="bg-orb orb-3"></div>
      </v-main>
    </v-app>
  </ClientOnly>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useSupabase } from '../composables/useSupabase'
import { formatMoney } from '../utils/format'

useHead({ title: 'Configuración Inicial - Aviva Check' })
definePageMeta({ layout: false })

const auth = useAuthStore()

const currentStep = ref(1)
const loading = ref(false)
const error = ref('')

// Step 1 data
const orgName = ref('')
const phone = ref('')
const address = ref('')

// Step 2 data
const productName = ref('')
const productPrice = ref(0)
const productCategory = ref('food')

const categoryOptions = [
  { title: 'Tacos', value: 'tacos' },
  { title: 'Hamburguesas', value: 'burgers' },
  { title: 'Pizzas', value: 'pizza' },
  { title: 'Snacks / Papas', value: 'snacks' },
  { title: 'Platillos / Otros', value: 'food' },
  { title: 'Bebidas / Refrescos', value: 'drink' },
  { title: 'Cafetería', value: 'coffee' },
  { title: 'Postres / Pan', value: 'dessert' },
  { title: 'Libros', value: 'book' },
  { title: 'Varios', value: 'other' },
]

// Step 3 data
const leaderEmail = ref('')
const leaderName = ref('')
const leaderPassword = ref('')

// Validation
const canProceed = computed(() => {
  switch (currentStep.value) {
    case 1:
      return orgName.value.length >= 3
    case 2:
      return productName.value.length > 0 && productPrice.value > 0
    case 3:
      return true // skippable
    default:
      return false
  }
})

function getSupabase() {
  try { return useSupabase() } catch { return null }
}

onMounted(async () => {
  await auth.init()

  // Si ya completó onboarding, redirigir
  if (auth.profile?.onboarding_completed) {
    return navigateTo('/page/POS/pointOfSales')
  }

  // Pre-llenar nombre de org desde display_name del profile
  // (el pastor puso el nombre de iglesia al registrarse)
  orgName.value = auth.profile?.display_name || ''

  // Intentar cargar nombre de org real
  const sb = getSupabase()
  if (sb?.from && auth.profile?.org_id) {
    const { data } = await sb
      .from('organizations')
      .select('name')
      .eq('id', auth.profile.org_id)
      .single()

    if (data?.name) {
      orgName.value = data.name
    }
  }
})

function prevStep() {
  if (currentStep.value > 1) currentStep.value--
}

async function nextStep() {
  if (!canProceed.value) return

  error.value = ''
  loading.value = true

  try {
    if (currentStep.value === 1) {
      await saveOrgConfig()
    }

    if (currentStep.value === 2) {
      await createProduct()
    }

    currentStep.value++
  } catch (e: any) {
    error.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

// Step 1: Save org configuration
async function saveOrgConfig() {
  const sb = getSupabase()
  if (!sb?.from || !auth.profile?.org_id) return

  const { error: updateError } = await sb
    .from('organizations')
    .update({
      name: orgName.value.trim(),
    })
    .eq('id', auth.profile.org_id)

  if (updateError) throw updateError
}

// Step 2: Create first product
async function createProduct() {
  const sb = getSupabase()
  if (!sb?.from || !auth.profile?.org_id) return
  if (!auth.profile?.id) throw new Error('No se pudo resolver el departamento del pastor')

  const { error: insertError } = await sb
    .from('products')
    .insert({
      name: productName.value.trim(),
      price: productPrice.value,
      category: productCategory.value,
      org_id: auth.profile.org_id,
      department_owner_id: auth.profile.id,
      active: true,
    })

  if (insertError) throw insertError
}

// Step 3: Create leader (optional) — usa mismo patrón seguro que users.vue
async function createLeader() {
  if (!leaderEmail.value || !leaderName.value || !leaderPassword.value) return

  const sb = getSupabase()
  if (!sb?.auth || !sb?.rpc) throw new Error('Supabase no disponible')

  // A. Cliente temporal para no cerrar la sesión del pastor
  const config = useRuntimeConfig()
  const { createClient } = await import('@supabase/supabase-js')
  const tempSupabase = createClient(
    config.public.supabaseUrl,
    config.public.supabaseKey,
    {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
          storageKey: `avivacheck-temp-onboarding-${Date.now()}-${Math.random().toString(36).slice(2)}`
        }
      }
    )

  // B. Crear usuario en auth (sin afectar sesión actual)
  const { data: authData, error: authError } = await tempSupabase.auth.signUp({
    email: leaderEmail.value.trim(),
    password: leaderPassword.value,
    options: {
      data: { full_name: leaderName.value.trim(), role: 'leader' }
    }
  })

  if (authError) throw new Error(`Error al crear cuenta: ${authError.message}`)
  if (!authData?.user?.id) throw new Error('No se pudo obtener ID del nuevo líder')

  // C. Provisionar perfil via RPC seguro (SECURITY DEFINER)
  const { error: rpcError } = await sb.rpc('provision_user_profile', {
    target_user_id: authData.user.id,
    user_email: leaderEmail.value.trim(),
    user_role: 'leader',
    user_display_name: leaderName.value.trim()
  })

  if (rpcError) throw new Error(`Error al provisionar líder: ${rpcError.message}`)
}

async function finishWithLeader() {
  error.value = ''
  loading.value = true

  try {
    if (leaderEmail.value && leaderName.value && leaderPassword.value) {
      await createLeader()
    }
    await finishOnboarding()
  } catch (e: any) {
    error.value = e?.message ?? String(e)
    loading.value = false
  }
}

async function finishOnboarding() {
  loading.value = true
  error.value = ''

  try {
    const sb = getSupabase()
    if (!sb?.rpc || !auth.profile?.id) throw new Error('Sesión no disponible')

    // Usar RPC seguro (SECURITY DEFINER) — no requiere permiso de auto-update
    const { error: rpcError } = await sb.rpc('complete_onboarding')
    if (rpcError) throw rpcError

    // Actualizar perfil local
    await auth.refreshProfile()

    // Redirigir al POS
    await navigateTo('/page/POS/pointOfSales')
  } catch (e: any) {
    error.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.onboarding-container {
  background: #09090b;
  min-height: 100vh;
  position: relative;
  overflow: hidden;
}

.glass-card {
  background: rgba(20, 20, 24, 0.85);
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 28px;
  box-shadow: 0 50px 100px -20px rgba(0,0,0,0.8);
  z-index: 10;
  position: relative;
}

.step-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.step-icon-box {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.step-icon-box.blue {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(37, 99, 235, 0.15));
  border: 1px solid rgba(59, 130, 246, 0.3);
}
.step-icon-box.green {
  background: linear-gradient(135deg, rgba(76, 175, 80, 0.3), rgba(56, 142, 60, 0.15));
  border: 1px solid rgba(76, 175, 80, 0.3);
}
.step-icon-box.purple {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.3), rgba(103, 58, 183, 0.15));
  border: 1px solid rgba(124, 58, 237, 0.3);
}

.field-label {
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
  border-radius: 14px !important;
  border: 1px solid rgba(255,255,255,0.08);
  transition: all 0.3s ease;
}
.epic-input :deep(.v-field--focused) {
  background: rgba(59, 130, 246, 0.1) !important;
  border-color: #3b82f6 !important;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
.epic-input :deep(input) {
  font-size: 1rem;
  padding-top: 16px;
  padding-bottom: 16px;
}
.epic-input :deep(.v-icon) {
  opacity: 0.6;
}

.bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(140px);
  opacity: 0.12;
  z-index: 0;
  pointer-events: none;
}
.orb-1 {
  width: 500px;
  height: 500px;
  background: #2563eb;
  top: -150px;
  right: -100px;
}
.orb-2 {
  width: 400px;
  height: 400px;
  background: #7c3aed;
  bottom: -100px;
  left: -100px;
}
.orb-3 {
  width: 300px;
  height: 300px;
  background: #059669;
  top: 40%;
  left: 10%;
}
</style>
