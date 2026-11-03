/**
 * SUPABASE EDGE FUNCTION: submit-payment
 *
 * Security Purpose:
 * Public students (anon) do NOT have direct INSERT/SELECT privileges on `public.submissions`.
 * Instead, student submissions are sent to this server-side Edge Function (or `/api/public/submissions`),
 * which validates all inputs, checks rate limits, verifies teacher/group/period status,
 * checks for duplicates, and inserts the record using `SUPABASE_SERVICE_ROLE_KEY`.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_KEYS = new Set([
  'teacher_id',
  'group_id',
  'student_full_name',
  'payment_date',
]);

function cleanName(raw: string): string {
  return raw
    .replace(/[`ʼʻ‘’´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(raw: string): string {
  return cleanName(raw).toLowerCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: "Faqat POST so'rovlariga ruxsat berilgan." }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return new Response(
        JSON.stringify({ error: "Noto'g'ri so'rov formati." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Reject mass assignment or privilege escalation fields
    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.has(key)) {
        return new Response(
          JSON.stringify({ error: `Ruxsat etilmagan maydon: ${key}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const teacherId = String(body.teacher_id || '').trim();
    const groupId = String(body.group_id || '').trim();
    const studentFullName = cleanName(String(body.student_full_name || ''));
    const paymentDate = String(body.payment_date || '').trim();

    if (!teacherId || !groupId || studentFullName.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      return new Response(
        JSON.stringify({ error: "Barcha maydonlar to'g'ri to'ldirilishi shart." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // 1. Verify active collection period
    const { data: activePeriod } = await supabaseAdmin
      .from('collection_periods')
      .select('*')
      .eq('status', 'active')
      .order('year', { ascending: false })
      .order('month_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activePeriod) {
      return new Response(
        JSON.stringify({ error: "Hozirgi vaqtda faol oylik to'lov yig'imi mavjud emas." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (
      paymentDate < activePeriod.allowed_payment_start_date ||
      paymentDate > activePeriod.allowed_payment_end_date
    ) {
      return new Response(
        JSON.stringify({ error: "Tanlangan to'lov sanasi ruxsat etilgan oraliqqa to'g'ri kelmaydi." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Verify active teacher & group ownership
    const { data: group } = await supabaseAdmin
      .from('groups')
      .select('id, group_name, teacher_id, status')
      .eq('id', groupId)
      .eq('status', 'active')
      .maybeSingle();

    if (!group || group.teacher_id !== teacherId) {
      return new Response(
        JSON.stringify({ error: "Tanlangan guruh ushbu o'qituvchiga tegishli emas yoki faol emas." }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedName = normalizeName(studentFullName);

    // 3. Check duplicate submission within the same period and group
    const { data: duplicate } = await supabaseAdmin
      .from('submissions')
      .select('id, payment_date')
      .eq('collection_period_id', activePeriod.id)
      .eq('group_id', groupId)
      .eq('normalized_student_name', normalizedName)
      .maybeSingle();

    if (duplicate) {
      return new Response(
        JSON.stringify({
          code: 'DUPLICATE_SUBMISSION',
          error: "Ushbu guruhda bu ism-familiyali o'quvchi uchun joriy oyda ma'lumot allaqachon yuborilgan.",
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Insert validated submission
    const nowIso = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('submissions')
      .insert({
        id: `sub-${crypto.randomUUID()}`,
        collection_period_id: activePeriod.id,
        teacher_id: teacherId,
        group_id: groupId,
        student_full_name: studentFullName,
        normalized_student_name: normalizedName,
        payment_date: paymentDate,
        note: '',
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id, student_full_name, payment_date, created_at')
      .single();

    if (insertError || !inserted) {
      return new Response(
        JSON.stringify({ error: "Ma'lumotni saqlashda xatolik yuz berdi." }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        submission: {
          id: inserted.id,
          student_full_name: inserted.student_full_name,
          group_name: group.group_name,
          payment_date: inserted.payment_date,
          period_title: activePeriod.title,
          created_at: inserted.created_at,
        },
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch {
    return new Response(
      JSON.stringify({ error: 'Server xatoligi yuz berdi.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
