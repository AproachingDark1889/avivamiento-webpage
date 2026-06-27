<template>
  <div class="pa-4">
    Redirigiendo a Corte de Caja...
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['auth'], layout: 'sistema', requiredAccess: 'cash' })
useHead({ title: 'Corte de Caja - Aviva Check' })

onMounted(() => {
  navigateTo('/page/POS/cashClosing', { replace: true })
})
</script>
