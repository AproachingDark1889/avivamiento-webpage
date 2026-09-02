import { createClient } from 'file:///C:/Users/ST/Desktop/avivamiento_webpage-main/avivamiento_webpage-main/node_modules/@supabase/supabase-js/dist/module/index.js';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('c:/Users/ST/Desktop/avivamiento_webpage-main/avivamiento_webpage-main/.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) env[k] = v.join('=');
});

const supabaseUrl = env['SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  console.log('Testing RPC call or querying routines...');
  // Check if we can call any known rpc or if we can query postgres schema via postgrest if exposed
  // Or check what tables exist
  const { data, error } = await supabase.from('profiles').select('id, email, role');
  console.log('Profiles currently:', data, error ? error.message : '');
}

check();
