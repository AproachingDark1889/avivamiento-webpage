// nuxt.config.ts - Configuración corregida y AUMENTADA por Ánima
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

export default defineNuxtConfig({
  compatibilityDate: '2024-12-08',

  future: {
    compatibilityVersion: 4,
  },

  ssr: false,

  // --- INYECCIÓN ÁNIMA: VARIABLES DE ENTORNO PÚBLICAS ---
  // Esto permite que el plugin lea las llaves desde tu archivo .env
  runtimeConfig: {
    public: {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY,
    }
  },
  // -------------------------------------------------------

  nitro: {
    compressPublicAssets: {
      brotli: true,
      gzip: true,
    },
    minify: true,
    preset: 'service-worker', // Cambio estratégico: Service Worker para SPA
    port: 3002,
    moduleSideEffects: ['vue-bundle-renderer'],
  },

  app: {
    baseURL: '/sistema/', // Mantenemos esto firme
    head: {
      title: 'Pastor Adrian Aguirre | Avivamiento Monterrey',
      htmlAttrs: {
        lang: 'es'
      },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: 'Iglesia Avivamiento Monterrey dirigida por el Pastor Adrian Aguirre. Únete a nuestra comunidad cristiana en Apodaca, Monterrey, Nuevo León. Cultos dominicales y reuniones de oración.'
        },
        {
          name: 'keywords',
          content: 'Adrian Aguirre, Pastor Adrian Aguirre, Avivamiento Monterrey, iglesia Monterrey, iglesia Apodaca, iglesia cristiana Monterrey, cultos cristianos Monterrey, pastor Monterrey, iglesia evangélica Monterrey'
        },
        { name: 'author', content: 'Iglesia Avivamiento Monterrey' },
        { name: 'robots', content: 'index, follow' },
        { name: 'googlebot', content: 'index, follow' },
        { name: 'format-detection', content: 'telephone=no' },
        { property: 'og:site_name', content: 'Avivamiento Monterrey' },
        { property: 'og:title', content: 'Pastor Adrian Aguirre | Avivamiento Monterrey' },
        { property: 'og:description', content: 'Iglesia Avivamiento Monterrey dirigida por el Pastor Adrian Aguirre. Únete a nuestra comunidad cristiana en Apodaca, Monterrey.' },
        { property: 'og:type', content: 'website' },
        { property: 'og:url', content: 'https://avivamientomonterrey.com' },
        { property: 'og:locale', content: 'es_MX' },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: 'Pastor Adrian Aguirre | Avivamiento Monterrey' },
        { name: 'twitter:description', content: 'Iglesia Avivamiento Monterrey - Pastor Adrian Aguirre' },
        { name: 'geo.region', content: 'MX-NLE' },
        { name: 'geo.placename', content: 'Apodaca, Monterrey' },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'dns-prefetch', href: 'https://www.google-analytics.com' },
        { rel: 'dns-prefetch', href: 'https://www.googletagmanager.com' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'canonical', href: 'https://avivamientomonterrey.com' }
      ],
      noscript: [
        // Google Tag Manager (noscript fallback)
        {
          children: '<iframe src="https://www.googletagmanager.com/ns.html?id=GTM-NP63RVGW" height="0" width="0" style="display:none;visibility:hidden"></iframe>',
          body: true
        }
      ]
    },
  },

  modules: [
    '@pinia/nuxt',
    '@nuxt/image',
    // Vuetify con estilos predeterminados
    async (_options, nuxt) => {
      nuxt.hooks.hook('vite:extendConfig', (config) => {
        config.plugins?.push(
          vuetify({
            autoImport: true,
            styles: true, // Activar estilos automáticos
          })
        )
      })
    },
  ],

  build: {
    transpile: ['vuetify'],
  },

  vite: {
    vue: {
      template: {
        transformAssetUrls,
      },
    },

    // Plugin para minificar CSS con cssnano
    plugins: process.env.NODE_ENV === 'production' ? [
      {
        name: 'css-minifier',
        async generateBundle(options, bundle) {
          const cssnano = (await import('cssnano')).default;
          const postcss = (await import('postcss')).default;

          for (const [fileName, chunk] of Object.entries(bundle)) {
            if (fileName.endsWith('.css') && 'source' in chunk) {
              const result = await postcss([
                cssnano({
                  preset: ['default', {
                    discardComments: { removeAll: true },
                    normalizeWhitespace: true,
                  }]
                })
              ]).process(chunk.source, { from: undefined });

              chunk.source = result.css;
            }
          }
        }
      }
    ] : [],

    ssr: {
      noExternal: ['vuetify'],
    },

    css: {
      devSourcemap: false,
      preprocessorOptions: {},
    },

    build: {
      minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
      // Forzar minificación CSS via plugin personalizado
      target: 'es2020',

      // Configuración de Terser para producción
      terserOptions: process.env.NODE_ENV === 'production' ? {
        compress: {
          drop_console: true,
          drop_debugger: true,
          passes: 2,
          pure_funcs: ['console.log', 'console.info', 'console.debug'],
          dead_code: true,
          conditionals: true,
          evaluate: true,
          booleans: true,
          loops: true,
          unused: true,
          hoist_funs: true,
          keep_fargs: false,
          hoist_vars: false,
          if_return: true,
          join_vars: true,
          side_effects: true,
          sequences: true,
          collapse_vars: true,
          reduce_vars: true,
          toplevel: true,
        },
        mangle: {
          safari10: true,
          keep_classnames: false,
          keep_fnames: false,
          toplevel: true,
        },
        format: {
          comments: false,
          beautify: false,
          ecma: 2020,
          ascii_only: false,
          indent_level: 0,
          max_line_len: false,
          semicolons: true,
          preserve_annotations: false,
          quote_style: 1,
          wrap_iife: false,
        },
      } : {},

      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules') && !id.includes('vuetify')) {
              if (id.includes('@mdi/font')) return 'mdi';
              return 'vendor';
            }
          },
          chunkFileNames: '_nuxt/[name]-[hash].js',
          entryFileNames: '_nuxt/[name]-[hash].js',
          assetFileNames: '_nuxt/[name]-[hash].[ext]',
        }
      },
      assetsInlineLimit: 4096,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 1000,

      // Configuración CSS - minificación via cssnano en postcss
      cssTarget: 'chrome61',
      // cssMinify: true, // Deshabilitado, se usa cssnano
    },

    esbuild: {
      // Desactivar esbuild en producción, usar terser
      drop: process.env.NODE_ENV === 'development' ? [] : ['console', 'debugger'],
      keepNames: false,
      minifyIdentifiers: false,
      minifySyntax: false,
      minifyWhitespace: false,
    },

    optimizeDeps: {
      include: ['vuetify'],
      exclude: ['@mdi/font'],
    },
  },

  experimental: {
    payloadExtraction: true,
    inlineRouteRules: true,
    viewTransition: true,
    componentIslands: false, // Desactivado para reducir memoria
    renderJsonPayloads: false, // Desactivado para reducir memoria
    localLayerAliases: false, // Desactivado para reducir memoria
  },

  routeRules: {
    '/': {
      prerender: true,
      headers: {
        'cache-control': 'public, max-age=3600, s-maxage=3600'
      }
    },
    '/land': {
      prerender: true,
      headers: {
        'cache-control': 'public, max-age=3600, s-maxage=3600'
      }
    },
    '/calendar': {
      swr: 3600,
    },
    '/ministerios': {
      swr: 3600,
    },
  },

  image: {
    format: ['webp'],
    quality: 80,
  },

  // Opción 1: Usar los estilos predeterminados de Vuetify
  css: [
    'vuetify/styles',
    '@mdi/font/css/materialdesignicons.css',
    '@/assets/styles/global.css',
  ],

  // Opción 2: Si necesitas configuraciones personalizadas, crea este archivo
  // y luego descomenta la línea en css:
  // css: [
  //   '@/assets/scss/vuetify.scss',
  //   '@mdi/font/css/materialdesignicons.css',
  // ],

  // PurgeCSS con postcss para eliminar CSS no usado + cssnano para minificar
  postcss: {
    plugins: {
      autoprefixer: {},
      ...(process.env.NODE_ENV === 'production' ? {
        '@fullhuman/postcss-purgecss': {
          content: [
            './app/**/*.{vue,js,ts}',
            './pages/**/*.{vue,js,ts}',
            './components/**/*.{vue,js,ts}',
            './layouts/**/*.{vue,js,ts}',
            './plugins/**/*.{js,ts}',
            './nuxt.config.{js,ts}',
          ],
          safelist: {
            standard: [
              /^v-/,
              /^mdi-/,
              /^bg-/,
              /^text-/,
              /^d-/,
              /^flex-/,
              /^ma-/, /^mx-/, /^my-/, /^mt-/, /^mb-/, /^ml-/, /^mr-/,
              /^pa-/, /^px-/, /^py-/, /^pt-/, /^pb-/, /^pl-/, /^pr-/,
              /^align-/,
              /^justify-/,
              /^fill-/,
              /^elevation-/,
            ],
            deep: [/v-.*/, /mdi-.*/],
            greedy: [/v-.*/, /mdi-.*/],
          },
          defaultExtractor: (content) => content.match(/[\w-/:]+(?<!:)/g) || [],
        },
        cssnano: {
          preset: ['default', {
            discardComments: { removeAll: true },
            normalizeWhitespace: true,
            minifyFontValues: true,
            minifySelectors: true,
            mergeLonghand: true,
            mergeRules: true,
            colormin: true,
            reduceIdents: false,
            zindex: false,
            minifyGradients: true,
            normalizeUrl: true,
            svgo: true,
          }]
        }
      } : {})
    },
  },

  typescript: {
    strict: false,
    typeCheck: false,
    shim: false,
  },

  sourcemap: {
    server: false,
    client: false,
  },

  devServer: {
    port: 3002,
    host: '0.0.0.0',
  },

  devtools: {
    enabled: process.env.NODE_ENV === 'development',
  },
})