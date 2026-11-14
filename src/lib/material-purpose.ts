export const MATERIAL_PURPOSES = [
  "presentation",
  "survey",
  "code",
  "other",
] as const;
export type MaterialPurpose = (typeof MATERIAL_PURPOSES)[number];
export const MATERIAL_PURPOSE_LABELS: Record<MaterialPurpose, string> = {
  presentation: "演示文稿",
  survey: "问卷",
  code: "代码包",
  other: "其他",
};
export type MaterialSummary = {
  total: number;
  counts: Record<MaterialPurpose, number>;
};

export function inferMaterialPurpose(name: string, url = ""): MaterialPurpose {
  let sourcePath = "";
  try {
    sourcePath = new URL(url).pathname;
  } catch {
    /* A title alone can still determine the purpose. */
  }
  if (/(wenjuan|wj\.qq|questionnaire|survey|问卷)/i.test(`${name} ${url}`))
    return "survey";
  if ([name, sourcePath].some((value) => /\.(pptx?|ppsx?|key)$/i.test(value)))
    return "presentation";
  if (
    [name, sourcePath].some((value) =>
      /\.(zip|tar|gz|tgz|7z|rar)$/i.test(value),
    ) ||
    /https?:\/\/(github\.com|gitee\.com)\//i.test(url)
  )
    return "code";
  return "other";
}

export function materialSummaryText(summary: MaterialSummary) {
  return MATERIAL_PURPOSES.filter((purpose) => summary.counts[purpose] > 0)
    .map(
      (purpose) =>
        `${MATERIAL_PURPOSE_LABELS[purpose]} ${summary.counts[purpose]}`,
    )
    .join(" · ");
}
