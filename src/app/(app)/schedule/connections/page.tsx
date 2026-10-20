import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMySchedule } from "@/lib/schedule/store";
import { shanghaiDay,addDays } from "@/lib/schedule/types";
import { CalendarConnectionsPanel } from "@/components/schedule/calendar-connections";
export const metadata = { title: "外部日历连接 · AgileCampus" };
export default async function Page() {
  const session = await auth(); if (!session?.user) redirect("/login");
  const data = await getMySchedule(session.user.id,{ startDate: shanghaiDay(),endDate: addDays(shanghaiDay(),180) });
  return <main className="mx-auto max-w-4xl space-y-5 py-8"><Link className="text-sm text-primary underline" href="/schedule">← 返回课表与日程</Link><header><h1 className="font-display text-2xl">外部日历</h1><p className="mt-2 text-sm text-ink-soft">连接自己的日历持续读取课程；仅在你明确选择时向外部发布本人手动日程。</p></header><CalendarConnectionsPanel events={data.items.filter(e => ["manual","emergency"].includes(e.source)).map(e => ({ id: e.id,title: e.title,startAt: e.startAt,revision: e.revision }))} />{data.nextOffset !== null && <p className="text-sm text-ink-soft">日程较多，发布选择仅列出前 50 条记录中的手动日程。可先在课表页面整理日程，持续读取不受此列表影响。</p>}</main>;
}
