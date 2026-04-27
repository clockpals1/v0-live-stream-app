import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_RULE_TYPES = [
  "daily_content_ideas",
  "weekly_summary",
  "post_stream_recap",
  "affiliate_campaign",
  "short_video_autopilot",
  "evergreen_repurpose",
] as const;

const RULE_SCHEDULE: Record<string, string> = {
  daily_content_ideas:   "daily",
  weekly_summary:        "weekly",
  post_stream_recap:     "post_stream",
  affiliate_campaign:    "weekly",
  short_video_autopilot: "daily",
  evergreen_repurpose:   "weekly",
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: host } = await supabase
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!host) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  const { data: rules, error } = await supabase
    .from("ai_automation_rules")
    .select("id, rule_type, label, enabled, schedule, config, last_run_at, next_run_at, run_count, created_at")
    .eq("host_id", host.id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: rules ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: host } = await supabase
    .from("hosts")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (!host) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const { rule_type, label, config } = body as {
    rule_type?: string;
    label?: string;
    config?: Record<string, unknown>;
  };

  if (!rule_type || !VALID_RULE_TYPES.includes(rule_type as typeof VALID_RULE_TYPES[number])) {
    return NextResponse.json({ error: "Invalid rule_type" }, { status: 400 });
  }
  if (!label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (rule_type === "affiliate_campaign" && !((config as Record<string,unknown>)?.product_name as string)?.trim()) {
    return NextResponse.json({ error: "product_name is required for affiliate_campaign" }, { status: 400 });
  }
  if (rule_type === "short_video_autopilot" && !((config as Record<string,unknown>)?.niche as string)?.trim()) {
    return NextResponse.json({ error: "niche is required for short_video_autopilot" }, { status: 400 });
  }

  const schedule = RULE_SCHEDULE[rule_type];

  const { data: rule, error: insertErr } = await supabase
    .from("ai_automation_rules")
    .insert({
      host_id:   host.id,
      rule_type,
      label:     label.trim(),
      schedule,
      config:    config ?? {},
      enabled:   true,
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ rule }, { status: 201 });
}
