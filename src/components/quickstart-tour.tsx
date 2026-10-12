"use client";
import { useRef, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Driver, DriveStep } from "driver.js";
import "driver.js/dist/driver.css";

export function QuickstartTour() {
  const active = useRef<Driver | null>(null),
    [loading, setLoading] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    active.current?.destroy();
    return () => active.current?.destroy();
  }, [pathname]);
  async function start() {
    setLoading(true);
    try {
      const { driver } = await import("driver.js");
      const candidates: DriveStep[] = [
        {
          popover: {
            title: "一分钟认识页面",
            description:
              "团队负责成员和角色，项目承载任务与成果。可以随时结束引导，教程随时可重新打开。",
          },
        },
        {
          element: '[data-tour="workspace-summary"]',
          popover: {
            title: "先看今天需要关注什么",
            description:
              "逾期、今天截止、待修改成果和未读通知分别呈现。点击卡片可进入对应区域。",
          },
        },
        {
          element: '[data-tour="workspace-tasks"]',
          popover: {
            title: "缩小任务范围",
            description:
              "按截止时间、项目或关键词筛选自己的任务；点击任务进入详情。Ctrl K 可以快速查找入口。",
          },
        },
        {
          element: '[data-tour="workspace-schedule"]',
          popover: {
            title: "结合自己的日程",
            description:
              "这里只显示你本人的日程。临时事件使安排过期时，会提示重新核对个人规划。",
          },
        },
        {
          element: '[data-tour="teams"]',
          popover: {
            title: "先加入团队",
            description:
              "负责人创建团队，其他同学用邀请码加入。只有管理员能创建项目、管理里程碑和成员角色。",
          },
        },
        {
          element: '[data-tour="projects"]',
          popover: {
            title: "打开课程项目",
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
          element: '[data-tour="account"]',
          popover: {
            title: "个人设置在这里",
            description:
              "账户菜单中有我的课表、设置和新手教程。完整教程按负责人、组员、老师分别说明。",
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
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      type="button"
      disabled={loading}
      onClick={start}
      className="whitespace-nowrap rounded-field px-2.5 py-1.5 text-sm text-primary hover:bg-primary-soft"
    >
      {loading ? "加载引导…" : "页面引导"}
    </button>
  );
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
        <strong>第一次使用？</strong> 从团队、任务到提交成果，
        <Link href="/help" className="text-primary underline">
          五分钟快速上手
        </Link>
        。AI 配置可以稍后再做。
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
