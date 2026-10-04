// Loaded only into the dedicated LOCAL Nuxt process via NODE_OPTIONS.
const net = require('node:net');
const dns = require('node:dns');
function allowed(host) { return !host || ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(String(host)); }
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = normalized[0];
  const host = typeof options === 'object' ? options.host : (typeof normalized[1] === 'string' ? normalized[1] : undefined);
  if (!allowed(host)) throw new Error('LOCAL_TEST_EXTERNAL_SOCKET_BLOCKED');
  return connect.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = function(host, ...args) {
  if (!allowed(host)) throw new Error('LOCAL_TEST_EXTERNAL_DNS_BLOCKED');
  return lookup.call(this, host, ...args);
};
if (dns.promises) {
  const promiseLookup = dns.promises.lookup;
  dns.promises.lookup = async function(host, ...args) {
    if (!allowed(host)) throw new Error('LOCAL_TEST_EXTERNAL_DNS_BLOCKED');
    return promiseLookup.call(this, host, ...args);
  };
}
