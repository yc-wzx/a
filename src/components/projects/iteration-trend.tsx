import { getIterationTrend } from "@/lib/iteration-trend";

export async function IterationTrend({ actorId, projectId, iterationId }: { actorId:string;projectId:string;iterationId:string }) {
  const data = await getIterationTrend(actorId,projectId,iterationId), points = data.points;
  const max = Math.max(1,...points.map(p=>p.total));
  const axisEnd = [data.endDate,data.availableFrom??data.endDate,...points.map(p=>p.day)].sort().at(-1)!;
  const x = (day:string) => 60 + Math.max(0,(Date.parse(day)-Date.parse(data.availableFrom??day)) / Math.max(86400000,Date.parse(axisEnd)-Date.parse(data.availableFrom??day))) * 660;
  const y = (n:number) => 190-n/max*150;
  return <section className="ac-card space-y-3 p-5" aria-label="迭代趋势">
    <div className="flex justify-between"><h2 className="font-medium">迭代趋势</h2><span className="text-xs text-ink-faint">剩余主任务数</span></div>
    <p className="text-xs text-ink-soft">{data.note}</p>
    {points.length ? <>
      <p className="text-xs text-ink-faint">记录始于 {data.availableFrom}；此前日期没有可核实的每日快照。{axisEnd>data.endDate?` 原计划截止 ${data.endDate}，采样已超过计划日期。`:null}</p>
      <svg role="img" aria-label="每日剩余任务趋势图" viewBox="0 0 780 235" className="w-full">
        <title>剩余任务趋势</title><desc>实线表示实际采样。计划结束晚于首次采样时显示参考虚线；参考线不是预测。</desc>
        <line x1="60" y1="190" x2="735" y2="190" stroke="currentColor" opacity=".25"/><line x1="60" y1="30" x2="60" y2="190" stroke="currentColor" opacity=".25"/>
        <text x="20" y="40" fontSize="12">{max}</text><text x="32" y="194" fontSize="12">0</text>
        {data.endDate>(data.availableFrom??data.endDate)&&<line x1="60" y1={y(points[0].remaining)} x2={x(data.endDate)} y2="190" stroke="currentColor" strokeDasharray="6 5" opacity=".3"/>}
        <polyline points={points.map(p=>`${x(p.day)},${y(p.remaining)}`).join(" ")} stroke="var(--color-primary,#6366f1)" strokeWidth="3" fill="none"/>
        {points.map(p=><g key={p.day}><circle cx={x(p.day)} cy={y(p.remaining)} r="4" fill="var(--color-primary,#6366f1)"><title>{`${p.day} 剩余${p.remaining}，共${p.total}项`}</title></circle><text x={x(p.day)} y={y(p.remaining)-10} textAnchor="middle" fontSize="12">{p.remaining}</text></g>)}
        <text x="60" y="222" fontSize="12">{data.availableFrom}</text><text x="720" y="222" textAnchor="end" fontSize="12">{axisEnd}</text>
      </svg>
      <details><summary className="cursor-pointer text-sm text-primary">查看每日数据与范围变化</summary><table className="mt-3 w-full text-left text-sm"><thead><tr><th>日期</th><th>总数</th><th>已完成</th><th>剩余</th><th>较上次记录的范围变化</th></tr></thead><tbody>{points.map(p=><tr key={p.day}><td>{p.day}</td><td>{p.total}</td><td>{p.done}</td><td>{p.remaining}</td><td>新增{p.added}／移出{p.removed}</td></tr>)}</tbody></table></details>
    </> : <p className="text-sm text-ink-soft">{data.status==="planned"?"开始迭代后记录趋势。":"这一轮尚无每日快照，原有结束统计和历史仍可查看。"}</p>}
  </section>;
}
