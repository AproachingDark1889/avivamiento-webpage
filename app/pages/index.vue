<template>
  <div></div>
</template>

<script setup>
// La raíz redirige al login del POS
definePageMeta({
  layout: false,
  middleware: [
    function () {
      return navigateTo('/login', { replace: true })
    }
  ]
})
</script>
