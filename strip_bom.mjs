import fs from 'fs';
const p = 'supabase/config.toml';
let content = fs.readFileSync(p, 'utf8');
if (content.charCodeAt(0) === 0xFEFF) {
  content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
  console.log('BOM stripped from config.toml');
} else {
  console.log('No BOM found in config.toml');
}
