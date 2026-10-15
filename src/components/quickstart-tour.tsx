"use client";
import { useRef, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Driver, DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

export function QuickstartTour({ label = "开始页面操作指引" }: { label?: string }) {
  const active = useRef<Driver | null>(null),
    [loading, setLoading] = useState(false), [error, setError] = useState("");
  const pathname = usePathname();
  useEffect(() => {
    active.current?.destroy();
    return () => active.current?.destroy();
  }, [pathname]);
  async function start(event: React.MouseEvent<HTMLButtonElement>) {
    const menu = event.currentTarget.closest("details");
    if (menu) menu.open = false;
    setLoading(true); setError("");
    try {
      const { driver } = await import("driver.js");
      const candidates: DriveStep[] = [
        {
          popover: {
            title: "页面操作指引",
            description:
              "团队负责成员和角色，项目承载任务与成果。可以随时结束引导，教程随时可重新打开。",
          },
        },
        {
          element: '[data-tour="workspace-summary"]',
          popover: {
            title: "待处理事项",
            description:
              "逾期、今天截止、待修改成果和未读通知分别呈现。点击卡片可进入对应区域。",
          },
        },
        {
          element: '[data-tour="workspace-tasks"]',
          popover: {
            title: "任务与日历",
            description:
              "切换任务列表与日历。日历按周、月或事项查看本人课表、已确认工作安排及项目截止节点；截止日期不占用工作时段。点击任务在当前页面查看详情。",
          },
        },
        {
          element: '[data-tour="workspace-schedule"]',
          popover: {
            title: "个人日程与规划",
            description:
              "这里只显示你本人的日程。临时事件使安排过期时，会提示重新核对个人规划。",
          },
        },
        {
          element: '[data-tour="teams"]',
          popover: {
            title: "团队与角色",
            description:
              "负责人创建团队，其他同学用邀请码加入。只有管理员能创建项目、管理里程碑和成员角色。",
          },
        },
        {
          element: '[data-tour="projects"]',
          popover: {
            title: "项目入口",
            description:
              "项目里的阶段节点叫里程碑。迭代是一次短周期的工作安排，两者用途不同。",
          },
        },
        {
          element: '[data-tour="milestones"]',
          popover: {
            title: "管理阶段节点",
            description:
              "管理员可添加或删除里程碑。删除前会显示影响范围；关联任务及历史成果保留。",
          },
        },
        {
          element: "[data-project-sidebar]",
          popover: {
            title: "项目入口集中在左侧",
            description:
              "概览、任务和迭代随时可打开；展开协作或成果与记录，可进入公告、资料、成果和周报。深色项表示当前位置。",
          },
        },
        {
          element: '[data-tour="board"]',
          popover: {
            title: "选择适合的任务视图",
            description:
              "看板推进状态，列表核对分工，甘特图查看排期。三种视图共用筛选和任务详情；展开常用筛选可保存到当前浏览器。",
          },
        },
        {
          element: '[data-tour="assistant"]',
          popover: {
            title: "使用自己的 AI 助手",
            description:
              "先在设置配置自己的服务商、模型与密钥。默认个人会话仅本人可见，AI 草案仍需要你确认。",
          },
        },
        {
          element: '[data-tour="ai-settings"]',
          popover: {
            title: "配置个人 AI",
            description:
              "选择服务商，填写模型和 API 密钥后保存并测试。未配置也可以正常协作和使用规则规划。",
          },
        },
        {
          element: "[data-project-directory]",
          popover: { title: "项目目录", description: "搜索项目，按团队或状态筛选；任务进度包含子任务。项目卡片提供概览、任务、文档和成果入口。" },
        },
        {
          element: "[data-team-directory]",
          popover: { title: "团队目录", description: "查看成员、项目及自己的角色，复制邀请码邀请成员。创建与加入操作集中在右侧。" },
        },
        {
          element: "[data-notification-center]",
          popover: { title: "通知中心", description: "切换全部或未读消息，按项目筛选，通过来源进入对应工作。标记已读不改变任务或成果状态。" },
        },
        {
          element: "[data-document-library]",
          popover: { title: "项目文档目录", description: "新建或导入文档，按目录和关键词检索；个人草稿按文档授权开放，误删文档可从回收站恢复。" },
        },
        {
          element: "[data-document-editor]",
          popover: { title: "文档编辑与协作", description: "在正文协作编辑，用评论、版本和任务面板处理反馈、留存历史、关联工作。先检查保存状态再关闭页面。" },
        },
        {
          element: "[data-team-members]",
          popover: { title: "成员与个人主页", description: "按姓名、技能或角色查找成员，点击姓名或查看个人主页，了解共同团队中的任务与成果。" },
        },
        {
          element: '[data-tour="member-introduction"]',
          popover: { title: "个人介绍", description: "这里展示本人维护的介绍、技能和团队角色。自己的主页提供编辑资料入口。" },
        },
        {
          element: '[data-tour="member-tabs"]',
          popover: { title: "查看工作与成果", description: "概览汇总参与项目和近期记录；任务可按状态筛选；成果展示正式提交及审核状态。" },
        },
        {
          element: '[data-tour="account"]',
          popover: {
            title: "个人设置在这里",
            description:
              "账户菜单提供我的主页、课表、设置和新手教程。完整教程按负责人、组员、老师分别说明。",
          },
        },
      ];
      const steps = candidates.filter(
        (step) =>
          typeof step.element !== "string" ||
          document.querySelector(step.element),
      );
      active.current?.destroy();
      active.current = driver({
        steps,
        showProgress: true,
        progressText: "{{current}} / {{total}}",
        nextBtnText: "下一步",
        prevBtnText: "上一步",
        doneBtnText: "完成",
        allowClose: true,
        disableActiveInteraction: true,
        popoverClass: "agilecampus-tour",
      });
      active.current.drive();
    } catch {
      setError("操作指引暂时无法加载，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }
  return (
    <><button
      type="button"
      disabled={loading}
      onClick={start}
      className="whitespace-nowrap rounded-field px-2.5 py-1.5 text-sm text-primary hover:bg-primary-soft"
    >
      {loading ? "加载操作指引…" : label}
    </button>{error && <span role="alert" className="text-xs text-high">{error}</span>}</>
  );
}

export function TutorialMenu() {
  return <details className="relative" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
    <summary aria-label="新手教程菜单" className="cursor-pointer list-none whitespace-nowrap rounded-field px-2.5 py-1.5 text-sm text-ink-soft hover:bg-primary-soft [&::-webkit-details-marker]:hidden">新手教程 <span aria-hidden className="text-[10px]">▾</span></summary>
    <div className="absolute right-0 z-30 mt-2 w-52 rounded-field border border-line bg-surface p-2 shadow-pop">
      <Link href="/help" onClick={event => { const menu = event.currentTarget.closest("details"); if (menu) menu.open = false; }} className="block rounded px-2.5 py-2 text-sm hover:bg-primary-soft">使用指南与角色流程</Link>
      <QuickstartTour label="当前页面操作指引" />
    </div>
  </details>;
}

function subscribeHint(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("agilecampus:quickstart-dismiss", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("agilecampus:quickstart-dismiss", onChange);
  };
}

export function GettingStartedHint({ userId }: { userId: string }) {
  const pathname = usePathname();
  const storageKey = `agilecampus:quickstart:v1:${userId}`;
  const [closed, setClosed] = useState(false);
  const dismissed = useSyncExternalStore(
    subscribeHint,
    () => {
      try {
        return localStorage.getItem(storageKey) === "dismissed";
      } catch {
        return false;
      }
    },
    () => false,
  );
  if (pathname !== "/dashboard" || dismissed || closed) return null;
  return (
    <aside className="mb-4 flex items-center justify-between gap-4 rounded-field border border-line bg-primary-soft p-4 text-sm">
      <div>
        <strong>使用指南</strong> 团队组建、任务协作和成果提交的操作说明见
        <Link href="/help" className="text-primary underline">
          新手教程
        </Link>
        。个人 AI 为可选功能。
      </div>
      <button
        type="button"
        aria-label="关闭新手提示"
        onClick={() => {
          setClosed(true);
          try {
            localStorage.setItem(storageKey, "dismissed");
            window.dispatchEvent(new Event("agilecampus:quickstart-dismiss"));
          } catch {}
        }}
        className="shrink-0 text-ink-soft"
      >
        暂时关闭
      </button>
    </aside>
  );
}
