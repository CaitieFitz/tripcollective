// TripCollective — Supabase Configuration
// ✅ Safe to use in frontend (anon key + RLS protects data)
// ❌ Never commit your service_role key

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://dixzwvaytvjifiykzyud.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpeHp3dmF5dHZqaWZpeWt6eXVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNDEwMTgsImV4cCI6MjA5NDcxNzAxOH0.E2r_RD_u5HuvT9P93G-i8VAlvuaTgVL7FWTOmAEUdbk'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)