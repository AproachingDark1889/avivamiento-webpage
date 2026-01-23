module.exports = {
  apps: [{
    name: 'avivamiento',
    script: '.output/server/index.mjs',
    env: {
      PORT: 3002,
      NODE_ENV: 'production'
    }
  }]
}
