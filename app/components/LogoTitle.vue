<template>
  <v-toolbar-title class="logo-title-root">
    <img
      class="logo-image"
      :src="src"
      :alt="alt"
    />
  </v-toolbar-title>
</template>

<script setup>
const props = defineProps({
  src: { type: String, default: '/images/logo_avivamiento.png' },
  alt: { type: String, default: 'Avivamiento Monterrey' },
  height: { type: String, default: '35px' },
})
</script>

<style scoped>
/* Base logo styling */
.logo-image {
  display: block;
  width: auto;
  height: 35px; /* Default height */
}

/* Tablet and below (iPad, small laptops) */
@media (max-width: 768px) {
  .logo-image {
    height: 32px !important;
  }
}

/* Mobile landscape and small tablets */
@media (max-width: 600px) {
  .logo-image {
    height: 28px !important;
  }
}

/* Small mobile devices */
@media (max-width: 360px) {
  .logo-image {
    height: 26px !important;
  }
}
</style>
