/**
 * 极简 cron 解析器
 * 支持 5 字段: minute hour day month weekday
 * 字段值: * 或具体数字 (不支持范围/步进)
 */

export function nextCronMatch(cronExpr: string, after: Date): Date {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`invalid cron expression: ${cronExpr} (expected 5 fields)`);
  }

  const [minF, hourF, dayF, monthF, wdayF] = fields;

  // 从 after 的下一分钟开始搜索
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // 最多搜索 2 年
  const limit = new Date(after);
  limit.setFullYear(limit.getFullYear() + 2);

  while (candidate < limit) {
    if (
      matchField(minF, candidate.getMinutes()) &&
      matchField(hourF, candidate.getHours()) &&
      matchField(dayF, candidate.getDate()) &&
      matchField(monthF, candidate.getMonth() + 1) &&
      matchField(wdayF, candidate.getDay())
    ) {
      return candidate;
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  throw new Error(`no cron match found within 2 years for: ${cronExpr}`);
}

function matchField(field: string, value: number): boolean {
  if (field === "*") return true;

  // 逗号分隔的多个值
  const parts = field.split(",");
  for (const part of parts) {
    if (parseInt(part, 10) === value) return true;
  }

  return false;
}
