<template>
  <div class="pa-4 h-100 d-flex flex-column">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4 font-weight-black text-primary">
        <v-icon start size="36">mdi-food</v-icon>Catálogo de Productos
      </h1>
      <v-spacer />
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        rounded="lg"
        @click="openDialog()"
      >
        Nuevo Producto
      </v-btn>
    </div>

    <v-card elevation="2" class="flex-grow-1 overflow-hidden d-flex flex-column" rounded="xl" border>
      <v-data-table
        :headers="headers"
        :items="products"
        :loading="loading"
        hover
        density="comfortable"
        class="flex-grow-1 overflow-auto"
      >
        <template #item.price="{ item }">
          <span class="font-weight-bold">{{ money(item.price) }}</span>
        </template>
        
        <template #item.category="{ item }">
          <v-chip size="small" variant="tonal" class="text-uppercase" color="primary">
            {{ getCategoryTitle(item.category) }}
          </v-chip>
        </template>

        <template #item.active="{ item }">
          <v-chip
            size="small"
            :color="item.active ? 'success' : 'grey'"
            variant="flat"
          >
            {{ item.active ? 'Activo' : 'Inactivo' }}
          </v-chip>
        </template>

        <template #item.actions="{ item }">
          <v-btn icon="mdi-pencil" size="small" variant="text" color="primary" @click="openDialog(item)" />
          <v-btn icon="mdi-delete" size="small" variant="text" color="error" @click="confirmDelete(item)" />
        </template>
      </v-data-table>
    </v-card>

    <!-- Dialogo Edicion/Creacion -->
    <v-dialog v-model="dialog" max-width="500">
      <v-card rounded="xl">
        <v-card-title class="pa-4 bg-primary text-white">
          {{ editedItem.id ? 'Editar Producto' : 'Nuevo Producto' }}
        </v-card-title>
        
        <v-card-text class="pt-4">
          <v-text-field
            v-model="editedItem.name"
            label="Nombre del Producto"
            variant="outlined"
            density="comfortable"
            class="mb-2"
          />
          
          <v-row>
            <v-col cols="6">
              <v-text-field
                v-model.number="editedItem.price"
                label="Precio"
                type="number"
                prefix="$"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="6">
              <v-select
                v-model="editedItem.category"
                label="Categoría"
                :items="PRODUCT_CATEGORIES"
                item-title="title"
                item-value="value"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
          </v-row>

          <v-switch
            v-if="editedItem.id"
            v-model="editedItem.active"
            label="Producto Activo en Caja"
            color="success"
            hide-details
          />
        </v-card-text>

        <v-card-actions class="pa-4 pt-0">
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Cancelar</v-btn>
          <v-btn color="primary" variant="elevated" @click="save" :loading="saving">Guardar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Dialogo Confirmar Borrar -->
    <v-dialog v-model="dialogDelete" max-width="400">
      <v-card rounded="xl">
        <v-card-title class="pa-4 text-h6">¿Eliminar producto?</v-card-title>
        <v-card-text>Esta acción no se puede deshacer.</v-card-text>
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn variant="text" @click="dialogDelete = false">Cancelar</v-btn>
          <v-btn color="error" variant="elevated" @click="deleteItemConfirm" :loading="saving">Eliminar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useToast } from '../../../composables/useToast'
import { useProductsStore } from '../../../stores/products'
import type { Product } from '../../../types'
import { PRODUCT_CATEGORIES, getCategoryTitle } from '../../../utils/categories'
import { formatMoney } from '../../../utils/format'

definePageMeta({ middleware: ['auth'], layout: 'sistema' })
useHead({ title: 'Productos - Aviva Check' })

const toast = useToast()
const productsStore = useProductsStore()

// Store state mapping
const loading = computed(() => productsStore.loading)
const products = computed(() => productsStore.items)

const saving = ref(false)
const dialog = ref(false)
const dialogDelete = ref(false)

const editedItem = ref<Partial<Product>>({
  name: '',
  price: 0,
  category: 'food',
  active: true
})

const headers = [
  { title: 'Producto', key: 'name', align: 'start' },
  { title: 'Precio', key: 'price', align: 'end' },
  { title: 'Categoría', key: 'category', align: 'center' },
  { title: 'Estado', key: 'active', align: 'center' },
  { title: 'Acciones', key: 'actions', align: 'end', sortable: false },
] as const

onMounted(() => {
  productsStore.load({ includeInactive: true })
})

const money = formatMoney

function openDialog(item?: Product) {

  if (item) {
    editedItem.value = { ...item }
  } else {
    editedItem.value = { name: '', price: 0, category: 'food', active: true }
  }
  dialog.value = true
}

async function save() {
  saving.value = true
  try {
    const payload = {
      name: editedItem.value.name!,
      price: editedItem.value.price!,
      category: editedItem.value.category,
      active: editedItem.value.active ?? true
    }

    if (editedItem.value.id) {
      await productsStore.update(editedItem.value.id, payload)
      toast.success('Producto actualizado')
    } else {
      await productsStore.create(payload)
      toast.success('Producto creado')
    }
    
    dialog.value = false
  } catch (e: any) {
    toast.error(e.message || 'Error al guardar')
  } finally {
    saving.value = false
  }
}

function confirmDelete(item: Product) {
  editedItem.value = { ...item }
  dialogDelete.value = true
}

async function deleteItemConfirm() {
  if (!editedItem.value.id) return
  
  saving.value = true
  try {
    await productsStore.remove(editedItem.value.id)
    toast.success('Producto eliminado')
    dialogDelete.value = false
  } catch (e: any) {
    toast.error('Error al eliminar')
  } finally {
    saving.value = false
  }
}
</script>
