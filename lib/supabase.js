import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://aofuiawihwxbhvcvahbl.supabase.co';
const supabasePublishableKey = 'sb_publishable_Sj2OJRbdd2eQgf148qx3DQ_-zoG9ltp';

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
