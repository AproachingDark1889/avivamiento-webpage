import { localFetch, LOCAL } from './portal/local-environment.mjs';
const response = await localFetch(LOCAL.mail);
const html = await response.text();
console.log(JSON.stringify({ status: response.status, scripts: [...html.matchAll(/<script[^>]+src=["']([^"']+)/g)].map(m => m[1]) }));
const js = await (await localFetch(`${LOCAL.mail}/dist/app.js?v1.22.3`)).text();
console.log(JSON.stringify({ apiReferences: [...js.matchAll(/.{0,60}api\/v1.{0,110}/g)].map(m => m[0]).slice(0,15) }));
